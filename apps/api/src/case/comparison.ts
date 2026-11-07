import {
  type CalendarDate,
  type ComparisonCatalog,
  type ComparisonPreferences,
  type DecisionStates,
  type RouteStatus,
  bestRouteStatuses,
  compareDestinations,
  comparedCountries,
  selectComparisonVersion,
} from '@arca/domain';
import type { CaseEvaluationsView } from './evaluations.js';
import type { CaseRows } from './view.js';

export interface ComparisonSettings {
  readonly catalog: ComparisonCatalog;
  readonly routeIds: readonly string[];
  readonly states: DecisionStates;
  readonly today: CalendarDate;
}

/**
 * The viewer's destination comparison (ADR-0026): the active comparison version scored with their
 * preferences over every country with a route, and beside each country the best status the
 * viewer's own person has there, from the evaluations already computed. Nothing is stored or
 * logged. The route parses the answer with the contract's schema before it leaves.
 */
export function destinationComparison(
  rows: CaseRows,
  accountId: string,
  evaluated: CaseEvaluationsView,
  preferences: ComparisonPreferences,
  { catalog, routeIds, states, today }: ComparisonSettings,
) {
  const { active, pendingNewer } = selectComparisonVersion(catalog.identities(), states);
  const entry = active === undefined ? undefined : catalog.activeEntry(active, states);
  const compared = compareDestinations({
    entry,
    preferences,
    countries: comparedCountries(routeIds),
    today,
  });
  const me = rows.people.find((person) => person.accountId === accountId)?.id;
  const statuses: ReadonlyMap<string, RouteStatus> =
    me === undefined ? new Map() : bestRouteStatuses(evaluated.results, me);
  return {
    version:
      entry === undefined
        ? null
        : { comparisonId: entry.identity.comparisonId, number: entry.identity.number },
    pendingNewer,
    criteria: compared.criteria,
    countries: compared.countries.map((country) => ({
      ...country,
      routeStatus: statuses.get(country.country) ?? null,
    })),
    preferences,
  };
}

export type DestinationComparisonView = ReturnType<typeof destinationComparison>;
