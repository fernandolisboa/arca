import {
  type CatalogEntry,
  type ComparisonEntry,
  type RuleCaseSummary,
  ruleCaseSummarySchema,
} from '@arca/domain';
import { z } from 'zod';
import { parseComparisons, parseEntries, sha256Schema } from './entries.js';
import { caseData, catalogData, comparisonData, hostData } from './generated/catalog.js';

/**
 * Every version of a route, whatever its decision state, with each version's cases; and every
 * comparison version with the indicators it pins.
 */
export interface DisplayCatalog {
  readonly entries: () => readonly CatalogEntry[];
  readonly comparisons: () => readonly ComparisonEntry[];
  readonly versions: (routeId: string) => readonly CatalogEntry[];
  readonly cases: (hash: string) => readonly RuleCaseSummary[];
  /** A cited URL's host as the build's official-source matching read it, if it has one. */
  readonly hostOf: (url: string) => string | undefined;
}

const caseDataSchema = z.array(
  z.strictObject({ hash: sha256Schema, cases: z.array(ruleCaseSummarySchema) }),
);

const hostDataSchema = z.record(z.string(), z.string().nullable());

export function createDisplayCatalog(
  entries: ReadonlyMap<string, CatalogEntry>,
  cases: unknown,
  hosts: unknown,
  comparisons: ReadonlyMap<string, ComparisonEntry>,
): DisplayCatalog {
  const all = [...entries.values()];
  const allComparisons = [...comparisons.values()];
  const byHash = new Map(caseDataSchema.parse(cases).map((entry) => [entry.hash, entry.cases]));
  const byUrl = new Map(Object.entries(hostDataSchema.parse(hosts)));
  return {
    entries: () => all,
    comparisons: () => allComparisons,
    versions: (routeId) => all.filter(({ identity }) => identity.routeId === routeId),
    cases: (hash) => byHash.get(hash) ?? [],
    hostOf: (url) => byUrl.get(url) ?? undefined,
  };
}

/**
 * The content of every route and comparison version for the activation screen (spec 0007, R7;
 * ADR-0026), proposed and rejected ones included. Lint allows importing this entry point only where that screen's view is built,
 * never where `evaluateRoute` runs, so nothing read here reaches an evaluation (spec 0002, R5).
 */
export const displayCatalog = createDisplayCatalog(
  parseEntries(catalogData),
  caseData,
  hostData,
  parseComparisons(comparisonData),
);
