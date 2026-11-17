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
import type { RuleData } from '@arca/knowledge';
import { type DisplayCatalog, createDisplayCatalog } from '@arca/knowledge/display';

export interface KnowledgeVersions {
  /** Every stored version with its state, the newest first (spec 0007, R7; ADR-0031). */
  readonly list: () => Promise<readonly KnowledgeVersion[]>;
  /** One version as the admin reads it, with the hash of its cases a decision binds (ADR-0031). */
  readonly view: (
    routeId: string,
    number: number,
  ) => Promise<(VersionView & { readonly casesHash: string }) | undefined>;
  /** A route's version identities, which never carry a version's content. */
  readonly identities: (routeId: string) => Promise<readonly VersionIdentity[]>;
  /** The hosts of a country's newest official-domain list, by its lower-case code; none without one. */
  readonly officialHosts: (country: string) => Promise<readonly string[]>;
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
  /** The rules in the database (ADR-0031). */
  readonly rules: () => Promise<RuleData>;
}

const displays = new WeakMap<RuleData, DisplayCatalog>();

/** The display catalog over the rules read, built once for each reading. */
function displayOf(rules: RuleData): DisplayCatalog {
  let display = displays.get(rules);
  if (display === undefined) {
    display = createDisplayCatalog(rules);
    displays.set(rules, display);
  }
  return display;
}

/**
 * The activation screen's reads, the only place the display catalog is read: its content reaches
 * an admin as a view and never an evaluation or a comparison.
 */
export function createKnowledgeVersions({
  states,
  today,
  rules,
}: KnowledgeVersionSettings): KnowledgeVersions {
  const displayed = async () => displayOf(await rules());
  return {
    list: async () => {
      const [decided, catalog] = await Promise.all([states(), displayed()]);
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

    identities: async (routeId) =>
      (await displayed()).versions(routeId).map(({ identity }) => identity),

    officialHosts: async (country) => (await displayed()).newestOfficialHosts(country),

    view: async (routeId, number) => {
      const catalog = await displayed();
      const versions = catalog.versions(routeId);
      const entry = versions.find(({ identity }) => identity.number === number);
      const casesHash = entry === undefined ? undefined : catalog.casesHash(entry.identity.hash);
      if (entry === undefined || casesHash === undefined) return undefined;
      const view = versionView({
        versions,
        number,
        cases: catalog.cases(entry.identity.hash),
        states: await states(),
        today: today(),
        hostOf: catalog.hostOf,
      });
      return view === undefined ? undefined : { ...view, casesHash };
    },

    comparisons: async () => {
      const [decided, catalog] = await Promise.all([states(), displayed()]);
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
      const catalog = await displayed();
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

/** Each named route's version identities, read once per route. */
export async function identitiesOf(
  versions: Pick<KnowledgeVersions, 'identities'>,
  routeIds: Iterable<string>,
): Promise<ReadonlyMap<string, readonly VersionIdentity[]>> {
  return new Map(
    await Promise.all(
      [...new Set(routeIds)].map(
        async (routeId) => [routeId, await versions.identities(routeId)] as const,
      ),
    ),
  );
}
