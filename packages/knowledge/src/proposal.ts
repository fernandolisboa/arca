import {
  type CaseSnapshot,
  type CatalogEntry,
  type Pin,
  type RouteVersion,
  checkRouteVersion,
  checkVersionOrder,
  classifications,
  identityKey,
  routeVersionSchema,
} from '@arca/domain';
import { z } from 'zod';
import { runVersionCases } from './case-run.js';
import { type CasesFile, casesFileSchema } from './cases.js';
import { classificationKinds } from './datasets.js';
import type { Json } from './canonical.js';
import {
  type PinnedFileRow,
  type RuleRowReading,
  type RuleRows,
  pinKey,
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

/**
 * What a proposal is checked as (ADR-0031): the next version of a stored route, which keeps its
 * official-domain lists; or the first version of a new route of a country, which pins only the
 * lists the request allows, plus the first list it proposes for a country that has none.
 */
export type ProposalTarget =
  | { readonly kind: 'update'; readonly base: RouteVersion }
  | {
      readonly kind: 'new';
      /** ISO 3166-1 alpha-2, as the request named it. */
      readonly country: string;
      /** The approved lists of the country the version may pin. */
      readonly pins: readonly Pin[];
      /** The first official-domain list the same proposal holds, already checked on its own. */
      readonly list?: PinnedFileRow;
    };

/** The most problems a refused proposal names, so the correction's input stays bounded. */
export const maxProposalProblems = 50;

const codesFileSchema = z.object({ codes: z.array(z.string()) });

const codesOf = (reading: RuleRowReading, key: string): ReadonlySet<string> => {
  const parsed = codesFileSchema.safeParse(reading.datasetFiles[key]);
  return new Set(parsed.success ? parsed.data.codes : []);
};

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Where a proposal stands among the stored routes: what it must be, one line per problem. */
function targetProblems(
  storedRows: RuleRows,
  target: ProposalTarget,
  version: RouteVersion,
): string[] {
  if (target.kind === 'update') {
    const { base } = target;
    const next = Math.max(
      base.number,
      ...storedRows.routeVersions
        .filter((row) => row.routeId === base.routeId)
        .map((row) => row.number),
    );
    const problems: string[] = [];
    if (version.routeId !== base.routeId) problems.push('/routeId: The route it updates');
    if (version.number !== next + 1) problems.push(`/number: ${String(next + 1)}`);
    if (!sameJson(version.officialDomains, base.officialDomains)) {
      problems.push('/officialDomains: The lists of the version it updates');
    }
    return problems;
  }
  const { list } = target;
  const prefix = `${target.country.toLowerCase()}-`;
  const allowed = new Set([...target.pins, ...(list === undefined ? [] : [list])].map(pinKey));
  const problems: string[] = [];
  if (!version.routeId.startsWith(prefix)) problems.push(`/routeId: A new ID starting ${prefix}`);
  if (storedRows.routeVersions.some((row) => row.routeId === version.routeId)) {
    problems.push('/routeId: An ID no stored route has');
  }
  if (version.number !== 1) problems.push('/number: 1');
  if (version.country !== target.country) problems.push(`/country: ${target.country}`);
  if (version.officialDomains.length === 0) {
    problems.push('/officialDomains: At least one of the lists the request allows');
  }
  for (const pin of version.officialDomains) {
    if (!allowed.has(pinKey(pin))) {
      problems.push(`/officialDomains: ${pinKey(pin)} is not a list the request allows`);
    }
  }
  if (list !== undefined && !version.officialDomains.some((pin) => pinKey(pin) === pinKey(list))) {
    problems.push(`/officialDomains: The proposed list ${pinKey(list)}`);
  }
  return problems;
}

/**
 * Checks a proposed route version in code (ADR-0031), as the build checked a file: its schema;
 * where it stands (the next number of the route it updates with the same official-domain lists, so
 * a request never widens them, or the first version of a new route on the lists its request
 * allows); every pinned file present and unrefused, hashed as the read re-checks it; what the
 * schema cannot check (spec 0002, R4); and its cases, inline snapshots only, each with its expected
 * result and together under the coverage rules (spec 0002, R8).
 */
export async function checkProposal(
  storedRows: RuleRows,
  target: ProposalTarget,
  content: unknown,
  casesContent: unknown,
  reading: RuleRowReading,
): Promise<CheckedProposal | RefusedProposal> {
  // A new country's proposed list is read beside the stored ones, as it will be once stored.
  const rows: RuleRows =
    target.kind === 'new' && target.list !== undefined
      ? { ...storedRows, officialDomainLists: [...storedRows.officialDomainLists, target.list] }
      : storedRows;
  const refuse = (problems: readonly string[]): RefusedProposal => ({
    ok: false,
    problems: problems.slice(0, maxProposalProblems),
  });
  const parsed = routeVersionSchema.safeParse(content);
  if (!parsed.success) {
    return refuse(parsed.error.issues.map(({ path, message }) => `/${path.join('/')}: ${message}`));
  }
  const version = parsed.data;
  const problems = targetProblems(storedRows, target, version);
  // Ordered among the route's stored versions as the build ordered files (spec 0002, R6).
  const stored = rows.routeVersions.flatMap((row) => {
    const read = routeVersionSchema.safeParse(row.content);
    return row.routeId === version.routeId && read.success ? [read.data] : [];
  });
  const ordered =
    problems.length === 0 ? checkVersionOrder([...stored, version]) : new Map<number, string[]>();
  problems.push(
    ...(ordered.get(version.number) ?? []).map((problem) => `/effectiveFrom: ${problem}`),
  );
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
          ...rows.routeVersions.filter((row) => row.routeId !== version.routeId),
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
  for (const { id, members } of entry.countrySets) {
    if (members.some((member) => !current.has(member) && !former.has(member))) {
      problems.push(
        `/countrySets/${id}: A set's members are in the route's countries or former countries`,
      );
    }
  }
  const setsWithFormer = new Set(
    entry.countrySets
      .filter(({ members }) => members.some((member) => !current.has(member)))
      .map(({ id }) => id),
  );
  const pinnedCodes = Object.fromEntries(
    classifications.flatMap((name) => {
      const pin = version[name];
      return pin === undefined
        ? []
        : [
            [
              name,
              codesOf(reading, `${classificationKinds[name]}/${pin.id}/${String(pin.number)}`),
            ],
          ];
    }),
  );
  problems.push(
    ...checkRouteVersion(
      version,
      { hosts, hostOf: reading.hostOf },
      { current, former, setsWithFormer },
      pinnedCodes,
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
