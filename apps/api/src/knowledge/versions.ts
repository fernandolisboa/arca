import type { KnowledgeComparisonVersion, KnowledgeVersion } from '@arca/api-contract/routes';
import {
  type CalendarDate,
  type ComparisonVersionView,
  type DecisionStates,
  type VersionView,
  compareDates,
  comparisonStateOf,
  comparisonVersionView,
  stateOf,
  versionView,
} from '@arca/domain';
import { type DisplayCatalog, displayCatalog } from '@arca/knowledge/display';

export interface KnowledgeVersions {
  /** Every bundled version with its state, the newest first (spec 0007, R7). */
  readonly list: () => Promise<readonly KnowledgeVersion[]>;
  readonly view: (routeId: string, number: number) => Promise<VersionView | undefined>;
  /** Every bundled comparison version with its state, the newest first (ADR-0026). */
  readonly comparisons: () => Promise<readonly KnowledgeComparisonVersion[]>;
  readonly comparisonView: (
    comparisonId: string,
    number: number,
  ) => Promise<ComparisonVersionView | undefined>;
}

export interface KnowledgeVersionSettings {
  readonly states: () => Promise<DecisionStates>;
  /** Today in São Paulo, the date evaluations select versions at (spec 0007, R6). */
  readonly today: () => CalendarDate;
  readonly catalog?: DisplayCatalog;
}

/**
 * The activation screen's reads, the only place the display catalog is read: its content reaches
 * the approver as a view and never an evaluation or a comparison.
 */
export function createKnowledgeVersions({
  states,
  today,
  catalog = displayCatalog,
}: KnowledgeVersionSettings): KnowledgeVersions {
  return {
    list: async () => {
      const decided = await states();
      return catalog
        .entries()
        .map(({ identity, version }) => ({
          routeId: identity.routeId,
          number: identity.number,
          title: version.title,
          country: version.country,
          effectiveFrom: identity.effectiveFrom,
          hash: identity.hash,
          state: stateOf(identity, decided),
        }))
        .sort(
          (left, right) =>
            compareDates(right.effectiveFrom, left.effectiveFrom) ||
            left.routeId.localeCompare(right.routeId) ||
            right.number - left.number,
        );
    },

    view: async (routeId, number) => {
      const versions = catalog.versions(routeId);
      const entry = versions.find(({ identity }) => identity.number === number);
      if (entry === undefined) return undefined;
      return versionView({
        versions,
        number,
        cases: catalog.cases(entry.identity.hash),
        states: await states(),
        today: today(),
        hostOf: catalog.hostOf,
      });
    },

    comparisons: async () => {
      const decided = await states();
      return catalog
        .comparisons()
        .map(({ identity, version }) => ({
          comparisonId: identity.comparisonId,
          number: identity.number,
          title: version.title,
          hash: identity.hash,
          state: comparisonStateOf(identity, decided),
        }))
        .sort((left, right) => right.number - left.number);
    },

    comparisonView: async (comparisonId, number) => {
      const entries = catalog
        .comparisons()
        .filter(({ identity }) => identity.comparisonId === comparisonId);
      return comparisonVersionView({
        entries,
        number,
        states: await states(),
        hostOf: catalog.hostOf,
      });
    },
  };
}
