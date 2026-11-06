import {
  type CalendarDate,
  type DecisionStates,
  type RouteCatalog,
  buildCaseSnapshot,
  decisiveQuestions,
  evaluateRoute,
  routeResult,
} from '@arca/domain';
import type { CaseRows } from './view.js';

export interface EvaluationSettings {
  readonly catalog: RouteCatalog;
  readonly routeIds: readonly string[];
  readonly states: DecisionStates;
  /** Today in São Paulo: the snapshot's date, the rules' and the facts' (spec 0007, R6). */
  readonly today: CalendarDate;
  readonly engineCommit: string;
}

/**
 * Every route for each member of the case as principal, from what the viewer sees (spec 0007,
 * R6): the snapshot holds only the rows row-level security returned, so a hidden fact is an
 * unknown one. The FX table is empty in this slice. Nothing here is stored or logged. The route
 * parses the answer with the contract's schema before it leaves.
 */
export function caseEvaluations(
  rows: CaseRows,
  { catalog, routeIds, states, today, engineCommit }: EvaluationSettings,
) {
  const { snapshot, personIds } = buildCaseSnapshot(rows, today);
  const uuids = new Map([...personIds].map(([uuid, opaque]) => [opaque, uuid]));
  const uuid = (opaque: string) => {
    const found = uuids.get(opaque);
    if (found === undefined) throw new Error('A result names a person not in the case');
    return found;
  };
  const context = {
    rulesAsOf: today,
    factsAsOf: today,
    today,
    fx: { rates: [] },
    states,
    engineCommit,
  };
  const results = routeIds.flatMap((routeId) =>
    snapshot.members.map((principal) =>
      routeResult(evaluateRoute(snapshot, catalog, routeId, principal, context), principal),
    ),
  );
  const kept = new Set(
    rows.people.filter((person) => person.keptByMe).flatMap(({ id }) => personIds.get(id) ?? []),
  );
  return {
    rulesAsOf: today,
    engineCommit,
    results: results.map((result) => {
      // Only an active version's title and country reach the screen (CLAUDE.md rule 5).
      const identity =
        result.version === null || result.status === 'pending_activation'
          ? undefined
          : catalog
              .identities(result.routeId)
              .find(
                ({ number, hash }) =>
                  number === result.version?.number && hash === result.version.hash,
              );
      const entry = identity === undefined ? undefined : catalog.activeEntry(identity, states);
      // Named field by field, so the missing facts, with their case-internal IDs, stay here.
      return {
        routeId: result.routeId,
        principalId: uuid(result.principalId),
        status: result.status,
        route:
          entry === undefined
            ? null
            : { title: entry.version.title, country: entry.version.country },
        version: result.version,
        stale: result.stale,
        newerProposedVersion: result.newerProposedVersion,
        dependents: result.dependents.map(uuid),
        possibleDependents: result.possibleDependents.map(uuid),
        unitOpen: result.unitOpen,
        requirements: result.requirements,
        assessments: result.assessments,
        costs: result.costs.map((cost) => ({
          costId: cost.costId,
          title: cost.title,
          appliesTo: cost.appliesTo,
          personId: cost.personId === null ? null : uuid(cost.personId),
          applies: cost.applies,
          min: cost.min,
          max: cost.max,
          sources: cost.sources,
        })),
        durations: result.durations,
        closureSources:
          entry?.version.status === 'closed'
            ? (entry.version.closureSources ?? []).flatMap((id) =>
                entry.version.sources.filter((source) => source.id === id),
              )
            : [],
        missingRates: result.missingRates,
        missingDates: result.missingDates,
      };
    }),
    questions: decisiveQuestions(
      results,
      kept,
      new Set(
        snapshot.people.filter(({ birthDate }) => birthDate !== undefined).map(({ id }) => id),
      ),
    ).map((question) => ({
      ...question,
      personId: uuid(question.personId),
    })),
  };
}

export type CaseEvaluationsView = ReturnType<typeof caseEvaluations>;
