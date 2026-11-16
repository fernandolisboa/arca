import {
  type CatalogEntry,
  type ComparisonEntry,
  type Pin,
  type RuleCaseSummary,
} from '@arca/domain';
import { z } from 'zod';
import { parseComparisons } from './entries.js';
import { comparisonData, comparisonHostData } from './generated/runtime.js';
import { type RuleData, ruleContent } from './rule-rows.js';

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

const hostDataSchema = z.record(z.string(), z.string().nullable());

const comparisons = [...parseComparisons(comparisonData).values()];
const comparisonHosts = hostDataSchema.parse(comparisonHostData);

/**
 * The content of every route and comparison version for the activation screen (spec 0007, R7;
 * ADR-0026), proposed and rejected ones included: route versions from the rules the API read
 * (ADR-0031), comparison versions from the bundle. Lint allows importing this entry point only
 * where that screen's view is built, never where `evaluateRoute` runs, so nothing read here reaches
 * an evaluation (spec 0002, R5); the rules read are opaque everywhere else.
 */
export function createDisplayCatalog(data: RuleData): DisplayCatalog {
  const rules = ruleContent(data);
  const all = [...rules.entries.values()];
  const byHash = new Map(rules.cases.map((entry) => [entry.hash, entry.cases]));
  const byUrl = new Map(Object.entries({ ...comparisonHosts, ...rules.hosts }));
  const lists = new Map(
    rules.officialDomains.map((list) => [`${list.id}/${String(list.number)}`, list.hosts]),
  );
  const newest = new Map<string, { number: number; hosts: readonly string[] }>();
  for (const { id, number, hosts } of rules.officialDomains) {
    if ((newest.get(id)?.number ?? 0) < number) newest.set(id, { number, hosts });
  }
  return {
    entries: () => all,
    comparisons: () => comparisons,
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
