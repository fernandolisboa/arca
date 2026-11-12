import {
  type CatalogEntry,
  type ComparisonEntry,
  type Pin,
  type RuleCaseSummary,
  ruleCaseSummarySchema,
} from '@arca/domain';
import { z } from 'zod';
import { parseComparisons, parseEntries, sha256Schema } from './entries.js';
import {
  caseData,
  catalogData,
  comparisonData,
  hostData,
  officialDomainData,
} from './generated/catalog.js';

/**
 * Every version of a route, whatever its decision state, with each version's cases; and every
 * comparison version with the indicators it pins.
 */
export interface DisplayCatalog {
  readonly entries: () => readonly CatalogEntry[];
  readonly comparisons: () => readonly ComparisonEntry[];
  readonly versions: (routeId: string) => readonly CatalogEntry[];
  readonly cases: (hash: string) => readonly RuleCaseSummary[];
  /**
   * The host of a cited URL or machine-readable address as the build's official-source matching
   * read it, if it has one.
   */
  readonly hostOf: (url: string) => string | undefined;
  /**
   * The hosts of the pinned official-domain lists, which the independent check may fetch on
   * (ADR-0027), or undefined when the catalog lacks one of them.
   */
  readonly officialHosts: (pins: readonly Pin[]) => readonly string[] | undefined;
  /** The hosts of the newest official-domain list with this ID, none when there is no such list. */
  readonly newestOfficialHosts: (id: string) => readonly string[];
}

const caseDataSchema = z.array(
  z.strictObject({ hash: sha256Schema, cases: z.array(ruleCaseSummarySchema) }),
);

const hostDataSchema = z.record(z.string(), z.string().nullable());

const officialDomainDataSchema = z.array(
  z.strictObject({
    id: z.string(),
    number: z.int().min(1),
    hosts: z.array(z.string().min(1).max(253)).min(1),
  }),
);

export function createDisplayCatalog(
  entries: ReadonlyMap<string, CatalogEntry>,
  cases: unknown,
  hosts: unknown,
  comparisons: ReadonlyMap<string, ComparisonEntry>,
  officialDomains: unknown = [],
): DisplayCatalog {
  const all = [...entries.values()];
  const allComparisons = [...comparisons.values()];
  const byHash = new Map(caseDataSchema.parse(cases).map((entry) => [entry.hash, entry.cases]));
  const byUrl = new Map(Object.entries(hostDataSchema.parse(hosts)));
  const parsedLists = officialDomainDataSchema.parse(officialDomains);
  const lists = new Map(
    parsedLists.map((list) => [`${list.id}/${String(list.number)}`, list.hosts]),
  );
  const newest = new Map<string, { number: number; hosts: readonly string[] }>();
  for (const { id, number, hosts } of parsedLists) {
    if ((newest.get(id)?.number ?? 0) < number) newest.set(id, { number, hosts });
  }
  return {
    entries: () => all,
    comparisons: () => allComparisons,
    versions: (routeId) => all.filter(({ identity }) => identity.routeId === routeId),
    cases: (hash) => byHash.get(hash) ?? [],
    hostOf: (url) => byUrl.get(url) ?? undefined,
    officialHosts: (pins) => {
      const hosts: string[] = [];
      for (const pin of pins) {
        const listed = lists.get(`${pin.id}/${String(pin.number)}`);
        if (listed === undefined) return undefined;
        hosts.push(...listed);
      }
      return hosts;
    },
    newestOfficialHosts: (id) => newest.get(id)?.hosts ?? [],
  };
}

/**
 * The content of every route and comparison version for the activation screen (spec 0007, R7;
 * ADR-0026), proposed and rejected ones included. Lint allows importing this entry point only where
 * that screen's view is built, never where `evaluateRoute` runs, so nothing read here reaches an
 * evaluation (spec 0002, R5).
 */
export const displayCatalog = createDisplayCatalog(
  parseEntries(catalogData),
  caseData,
  hostData,
  parseComparisons(comparisonData),
  officialDomainData,
);
