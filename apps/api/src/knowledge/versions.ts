import type { KnowledgeComparisonVersion, KnowledgeVersion } from '@arca/api-contract/routes';
import {
  type CalendarDate,
  type ComparisonVersionView,
  type DecisionStates,
  type VersionIdentity,
  type VersionView,
  compareDates,
  comparisonStateOf,
  comparisonVersionView,
  stateOf,
  supersededVersions,
  versionView,
} from '@arca/domain';
import { type DisplayCatalog, displayCatalog } from '@arca/knowledge/display';
import type { CheckSubject } from './check/run.js';
import { checkContent } from './version-content.js';

export interface KnowledgeVersions {
  /** Every bundled version with its state, the newest first (spec 0007, R7). */
  readonly list: () => Promise<readonly Omit<KnowledgeVersion, 'check' | 'points'>[]>;
  readonly view: (routeId: string, number: number) => Promise<VersionView | undefined>;
  /** A route's version identities, which never carry a version's content. */
  readonly identities: (routeId: string) => readonly VersionIdentity[];
  /** The hosts of a country's newest official-domain list, by its lower-case code; none without one. */
  readonly officialHosts: (country: string) => readonly string[];
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
 * an admin as a view and never an evaluation or a comparison.
 */
export function createKnowledgeVersions({
  states,
  today,
  catalog = displayCatalog,
}: KnowledgeVersionSettings): KnowledgeVersions {
  return {
    list: async () => {
      const decided = await states();
      const asOf = today();
      const entries = catalog.entries();
      const superseded = new Map(
        [...new Set(entries.map(({ identity }) => identity.routeId))].map((routeId) => [
          routeId,
          supersededVersions(
            catalog.versions(routeId).map(({ identity }) => identity),
            asOf,
            decided,
          ),
        ]),
      );
      return entries
        .map(({ identity, version }) => ({
          routeId: identity.routeId,
          number: identity.number,
          title: version.title,
          country: version.country,
          effectiveFrom: identity.effectiveFrom,
          hash: identity.hash,
          state: stateOf(identity, decided),
          superseded: superseded.get(identity.routeId)?.has(identity.number) === true,
        }))
        .sort(
          (left, right) =>
            compareDates(right.effectiveFrom, left.effectiveFrom) ||
            left.routeId.localeCompare(right.routeId) ||
            right.number - left.number,
        );
    },

    identities: (routeId) => catalog.versions(routeId).map(({ identity }) => identity),

    officialHosts: (country) => catalog.newestOfficialHosts(country),

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

/**
 * What the independent check reads about a bundled route version (ADR-0027): its entry, its
 * content as the activation view lays it out, and the hosts of the lists it pins. Read here, where
 * the display catalog may be, since a proposed version's content is what the check is for. The
 * view needs no decision states: the content the check reads leaves the state out.
 */
export function createCheckSubjects(
  catalog: DisplayCatalog = displayCatalog,
): (routeId: string, number: number) => CheckSubject | undefined {
  return (routeId, number) => {
    const versions = catalog.versions(routeId);
    const entry = versions.find(({ identity }) => identity.number === number);
    if (entry === undefined) return undefined;
    const view = versionView({
      versions,
      number,
      cases: [],
      states: new Map(),
      today: entry.version.effectiveFrom,
      hostOf: catalog.hostOf,
    });
    if (view === undefined) return undefined;
    return { entry, content: checkContent(view), officialHosts: catalog.officialHosts };
  };
}
