import {
  type CaseSnapshot,
  type CatalogEntry,
  type Pin,
  type RouteVersion,
  checkRouteVersion,
  identityKey,
  routeVersionSchema,
} from '@arca/domain';
import { z } from 'zod';
import { runVersionCases } from './case-run.js';
import { type CasesFile, casesFileSchema } from './cases.js';
import type { Json } from './canonical.js';
import {
  type RuleRowReading,
  type RuleRows,
  routeVersionContentHash,
  ruleContent,
  ruleDataFromRows,
} from './rule-rows.js';

/** A proposed version that passed every check in code before a validator or an admin reads it. */
export interface CheckedProposal {
  readonly ok: true;
  readonly entry: CatalogEntry;
  readonly hash: string;
  readonly cases: CasesFile;
  /** The hosts of the pinned official-domain lists, or undefined when one of them is missing. */
  readonly officialHosts: (pins: readonly Pin[]) => readonly string[] | undefined;
}

/** Why a proposal is not a version: one line per problem, for the correction round. */
export interface RefusedProposal {
  readonly ok: false;
  readonly problems: readonly string[];
}

/** The most problems a refused proposal names, so the correction's input stays bounded. */
export const maxProposalProblems = 50;

const codesFileSchema = z.object({ codes: z.array(z.string()) });

const codesOf = (reading: RuleRowReading, key: string): ReadonlySet<string> => {
  const parsed = codesFileSchema.safeParse(reading.countryFiles[key]);
  return new Set(parsed.success ? parsed.data.codes : []);
};

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/**
 * Checks a proposed version of a route in code (ADR-0031), as the build checked a file: its schema;
 * the next number of the route it updates; the same official-domain lists as the version it
 * updates, so a request never widens them; every pinned file present and unrefused, hashed as the
 * read re-checks it; what the schema cannot check (spec 0002, R4); and its cases, inline snapshots
 * only, each with its expected result and together under the coverage rules (spec 0002, R8).
 */
export async function checkProposal(
  rows: RuleRows,
  base: RouteVersion,
  content: unknown,
  casesContent: unknown,
  reading: RuleRowReading,
): Promise<CheckedProposal | RefusedProposal> {
  const refuse = (problems: readonly string[]): RefusedProposal => ({
    ok: false,
    problems: problems.slice(0, maxProposalProblems),
  });
  const parsed = routeVersionSchema.safeParse(content);
  if (!parsed.success) {
    return refuse(parsed.error.issues.map(({ path, message }) => `/${path.join('/')}: ${message}`));
  }
  const version = parsed.data;
  const next = Math.max(
    base.number,
    ...rows.routeVersions.filter((row) => row.routeId === base.routeId).map((row) => row.number),
  );
  const problems: string[] = [];
  if (version.routeId !== base.routeId) problems.push('/routeId: The route it updates');
  if (version.number !== next + 1) problems.push(`/number: ${String(next + 1)}`);
  if (!sameJson(version.officialDomains, base.officialDomains)) {
    problems.push('/officialDomains: The lists of the version it updates');
  }
  const cases = casesFileSchema.safeParse(casesContent);
  if (!cases.success) {
    problems.push(
      ...cases.error.issues.map(({ path, message }) => `cases/${path.join('/')}: ${message}`),
    );
  }
  const hash = routeVersionContentHash(rows, content as Json, reading);
  if (hash === undefined) problems.push('A pinned file is missing or refused');
  if (problems.length > 0 || hash === undefined || !cases.success) return refuse(problems);

  const data = ruleContent(
    ruleDataFromRows(
      {
        ...rows,
        routeVersions: [
          ...rows.routeVersions.filter((row) => row.routeId !== base.routeId),
          {
            routeId: version.routeId,
            number: version.number,
            content: content as Json,
            contentHash: hash,
            cases: null,
          },
        ],
      },
      reading,
    ),
  );
  const entry = data.entries.get(identityKey({ ...version, hash }));
  if (entry === undefined) return refuse(['A pinned file is missing or refused']);
  const lists = new Map(
    data.officialDomains.map((list) => [`${list.id}/${String(list.number)}`, list.hosts]),
  );
  const hosts = version.officialDomains.flatMap(
    (pin) => lists.get(`${pin.id}/${String(pin.number)}`) ?? [],
  );
  const current = codesOf(
    reading,
    `countries/${version.countries.id}/${String(version.countries.number)}`,
  );
  const former = codesOf(
    reading,
    `former-countries/${version.formerCountries.id}/${String(version.formerCountries.number)}`,
  );
  const setsWithFormer = new Set(
    entry.countrySets
      .filter(({ members }) => members.some((member) => !current.has(member)))
      .map(({ id }) => id),
  );
  problems.push(
    ...checkRouteVersion(
      version,
      { hosts, hostOf: reading.hostOf },
      { current, former, setsWithFormer },
    ).map(({ path, message }) => `${path}: ${message}`),
  );
  if (!current.has(version.country))
    problems.push('/country: The country is in the pinned countries file');
  const run = await runVersionCases(entry, cases.data, (ruleCase): CaseSnapshot => {
    if (ruleCase.snapshot === undefined) throw new Error('A proposal case has an inline snapshot');
    return ruleCase.snapshot;
  });
  problems.push(...run.problems.map((problem) => `cases${problem}`));
  return problems.length > 0
    ? refuse(problems)
    : {
        ok: true,
        entry,
        hash,
        cases: cases.data,
        officialHosts: (pins) => {
          const found = pins.map((pin) => lists.get(`${pin.id}/${String(pin.number)}`));
          return found.every((listed) => listed !== undefined) ? found.flat() : undefined;
        },
      };
}
