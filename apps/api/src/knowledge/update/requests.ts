import type {
  NewRouteRequests,
  StartNewRouteRequest,
  UpdateProgress,
} from '@arca/api-contract/routes';
import {
  type DecisionStates,
  type ProposalList,
  type StageResult,
  checkCost,
  maxCheckCostMicroUsd,
  namedHosts,
  nextUpdateStep,
  proposalLists,
  routeVersionSchema,
  updateStages,
} from '@arca/domain';
import { type Database, withIdentity } from '@arca/db';
import {
  type RuleRowReading,
  type RuleRows,
  approvedOfficialDomainLists,
  pinKey,
  pinnedCountries,
  verifiedRouteVersion,
} from '@arca/knowledge';
import type { Logger } from '@arca/telemetry';
import { sql } from 'drizzle-orm';
import type { AuditLog } from '../../audit/log.js';
import { type AdminRole, readAdminHistory } from '../admins.js';
import { updateModelPrices, webSearchMicroUsd } from './prices.js';
import type { StoredEnd, StoredRequest, StoredStage, UpdateStore } from './store.js';

type CommonRefusal = 'not_admin' | 'not_found' | 'live' | 'not_configured' | 'not_started';

/** Why an update did not start: as any request's, or its route rests on a list nobody activated. */
export type StartRefusal = CommonRefusal | 'list_pending';

/** Why a new-route request did not start: as any request's, or a new country with no host to start on. */
export type NewRouteRefusal = CommonRefusal | 'links_needed';

export interface UpdateRequests {
  /** Asks for the route's newest version to be researched again, and starts the run. */
  readonly start: (
    accountId: string,
    routeId: string,
  ) => Promise<{ readonly requestId: string } | StartRefusal>;
  /** The route's newest request with its progress; never calls a model. */
  readonly newest: (
    accountId: string,
    routeId: string,
  ) => Promise<UpdateProgress | null | 'not_admin'>;
  /** Asks for a new route of a country (#461), and starts the run. */
  readonly startNewRoute: (
    accountId: string,
    request: StartNewRouteRequest,
  ) => Promise<{ readonly requestId: string } | NewRouteRefusal>;
  /** The newest new-route requests with their progress, and the countries; never calls a model. */
  readonly newRoutes: (accountId: string) => Promise<NewRouteRequests | 'not_admin'>;
}

export interface UpdateRequestsDependencies {
  /** The app_api pool. */
  readonly db: () => Database;
  readonly role: AdminRole;
  readonly audit: Pick<AuditLog, 'record'>;
  readonly store: UpdateStore;
  readonly rows: () => Promise<RuleRows>;
  readonly reading: RuleRowReading;
  /** The decisions' states, which say whether a list a request proposed is approved. */
  readonly states: () => Promise<DecisionStates>;
  /** Whether every stage's provider has a key; outside production the scripted models need none. */
  readonly configured: () => Promise<boolean>;
  /** Starts the workflow run with the request's identifier only. */
  readonly run: (requestId: string) => Promise<void>;
  readonly logger: Logger;
  /** Milliseconds since the epoch. */
  readonly now: () => number;
}

/** A request with no end this long after it was asked for no longer blocks a new one. */
export const updateLiveMs = 60 * 60 * 1000;

const route = 'knowledge:update-requests';

const asResult = (stage: StoredStage): StageResult =>
  stage.failure === null
    ? {
        stage: stage.stage,
        failure: null,
        needsCorrection: stage.needsCorrection,
        proposalValid: stage.proposalValid,
      }
    : { stage: stage.stage, failure: stage.failure };

/** The model calls' cost from the price table, plus each web search research made. */
function requestCost(stages: readonly StoredStage[]): UpdateProgress['cost'] {
  const cost = checkCost(
    stages.flatMap(({ usage }) => (usage === null ? [] : [usage])),
    updateModelPrices,
  );
  if (cost?.kind !== 'priced') return cost;
  const searches = stages.reduce((sum, { webSearches }) => sum + webSearches, 0);
  const microUsd = cost.microUsd + searches * webSearchMicroUsd;
  return microUsd > maxCheckCostMicroUsd ? { kind: 'unknown' } : { kind: 'priced', microUsd };
}

function progressState(end: StoredEnd | undefined, stalled: boolean): UpdateProgress['state'] {
  if (end !== undefined) return end.failure === null ? 'finished' : 'failed';
  return stalled ? 'stalled' : 'running';
}

function listCounts(end: StoredEnd | undefined): UpdateProgress['lists'] {
  if (end?.failure !== null) return null;
  const counts = Object.fromEntries(proposalLists.map((list) => [list, 0])) as Record<
    ProposalList,
    number
  >;
  for (const { list } of end.proposal.items) counts[list] += 1;
  return counts;
}

/** The number a finished request's proposal names, which it was stored under. */
const proposedNumber = (content: unknown): number | null => {
  const number = (content as { number?: unknown } | null)?.number;
  return typeof number === 'number' && Number.isInteger(number) && number > 0 ? number : null;
};

/** The route ID a finished new-route request's proposal took. */
const proposedRouteId = (content: unknown): string | null => {
  const routeId = (content as { routeId?: unknown } | null)?.routeId;
  return typeof routeId === 'string' ? routeId : null;
};

/** The most new-route requests the progress lists. */
const newRoutesShown = 10;

/**
 * Each country's approved official-domain lists as pins (ADR-0031): those its stored route
 * versions pin that are approved. A country with none is a new country.
 */
function countryPins(
  rows: RuleRows,
  reading: RuleRowReading,
  states: DecisionStates,
): ReadonlyMap<string, readonly string[]> {
  const approved = new Set(approvedOfficialDomainLists(rows, reading, states).map(pinKey));
  const pins = new Map<string, Set<string>>();
  for (const row of rows.routeVersions) {
    const parsed = routeVersionSchema.safeParse(row.content);
    if (!parsed.success) continue;
    const { country, officialDomains } = parsed.data;
    for (const pin of officialDomains.map(pinKey).filter((key) => approved.has(key))) {
      const held = pins.get(country) ?? new Set<string>();
      held.add(pin);
      pins.set(country, held);
    }
  }
  return new Map([...pins].map(([country, held]) => [country, [...held].sort()]));
}

/** Update requests on the app_api pool (ADR-0031): the start goes through the definer function. */
export function createUpdateRequests({
  db,
  role,
  audit,
  store,
  rows,
  reading,
  states,
  configured,
  run,
  logger,
  now,
}: UpdateRequestsDependencies): UpdateRequests {
  const isAdmin = async (accountId: string) =>
    role.basisOf(await readAdminHistory(db()), accountId) !== undefined;

  /** The route's newest version, only when the read verifies it: research never starts from a row changed in place. */
  const baseOf = async (routeId: string) => {
    const stored = await rows();
    const numbers = stored.routeVersions
      .filter((row) => row.routeId === routeId)
      .map(({ number }) => number);
    if (numbers.length === 0) return undefined;
    const newest = Math.max(...numbers);
    const verified = verifiedRouteVersion(stored, routeId, newest, reading);
    if (verified === undefined) return undefined;
    // Research never reads hosts no person approved: a first list waits for its decision.
    const approved = new Set(
      approvedOfficialDomainLists(stored, reading, await states()).map(pinKey),
    );
    return verified.version.officialDomains.every((pin) => approved.has(pinKey(pin)))
      ? newest
      : 'list_pending';
  };

  return {
    start: async (accountId, routeId) => {
      if (!(await isAdmin(accountId))) return 'not_admin';
      const baseNumber = await baseOf(routeId);
      if (baseNumber === undefined) return 'not_found';
      if (baseNumber === 'list_pending') return 'list_pending';
      if (!(await configured())) return 'not_configured';
      const stored = await withIdentity(db(), { accountId }, async (tx) => {
        const held = await role.held(tx, accountId);
        if (held === undefined) return 'not_admin' as const;
        const { basis, grantId } = held.basis;
        const { rows: started } = await tx.execute<{ id: string | null }>(sql`
          SELECT knowledge.start_update_request(${routeId}, ${baseNumber}, ${basis},
                                                ${grantId}::uuid) AS id`);
        const requestId = started[0]?.id ?? null;
        if (requestId === null) return 'live' as const;
        await audit.record({
          code: 'update_requested',
          subjectAccountId: accountId,
          actorAccountId: accountId,
          details: { requestId, routeId, baseNumber },
        });
        return { requestId };
      });
      if (typeof stored === 'string') return stored;
      try {
        await run(stored.requestId);
      } catch {
        // The request stays live for an hour, then shows as stalled; nothing is retried.
        logger.error({ route, errorCode: 'update_not_started' });
        return 'not_started';
      }
      return stored;
    },

    newest: async (accountId, routeId) => {
      if (!(await isAdmin(accountId))) return 'not_admin';
      const request = await store.newest(routeId);
      if (request === undefined) return null;
      const { progress } = await progressOf(request);
      return { ...progress, routeId: request.routeId, baseNumber: request.baseNumber };
    },

    startNewRoute: async (accountId, { country, visa, links = [] }) => {
      if (!(await isAdmin(accountId))) return 'not_admin';
      if (!pinnedCountries.countries.includes(country)) return 'not_found';
      const pins = countryPins(await rows(), reading, await states()).get(country) ?? [];
      // A new country's research may only start on hosts the admin named.
      if (pins.length === 0 && namedHosts(links, reading.hostOf).length === 0) {
        return 'links_needed';
      }
      if (!(await configured())) return 'not_configured';
      const stored = await withIdentity(db(), { accountId }, async (tx) => {
        const held = await role.held(tx, accountId);
        if (held === undefined) return 'not_admin' as const;
        const { basis, grantId } = held.basis;
        // Arrays as JSON text, which the driver binds as one value, never spread into a list.
        const asArray = (values: readonly string[]) =>
          sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))`;
        const { rows: started } = await tx.execute<{ id: string | null }>(sql`
          SELECT knowledge.start_new_route_request(${country}, ${visa}, ${asArray(links)},
                                                   ${asArray(pins)}, ${basis}, ${grantId}::uuid) AS id`);
        const requestId = started[0]?.id ?? null;
        if (requestId === null) return 'live' as const;
        await audit.record({
          code: 'update_requested',
          subjectAccountId: accountId,
          actorAccountId: accountId,
          details: { requestId, country },
        });
        return { requestId };
      });
      if (typeof stored === 'string') return stored;
      try {
        await run(stored.requestId);
      } catch {
        logger.error({ route, errorCode: 'update_not_started' });
        return 'not_started';
      }
      return stored;
    },

    newRoutes: async (accountId) => {
      if (!(await isAdmin(accountId))) return 'not_admin';
      const [requests, pins] = await Promise.all([
        store.newRoutes(newRoutesShown),
        rows().then(async (stored) => countryPins(stored, reading, await states())),
      ]);
      const shown = await Promise.all(
        requests.map(async (request) => {
          const { progress, end } = await progressOf(request);
          return {
            ...progress,
            country: request.country,
            visa: request.visa,
            newCountry: request.listPins.length === 0,
            proposedRouteId: end?.failure === null ? proposedRouteId(end.proposal.content) : null,
          };
        }),
      );
      return {
        requests: shown,
        countries: [...pinnedCountries.countries],
        countriesWithLists: [...pins.keys()].filter((code) =>
          pinnedCountries.countries.includes(code),
        ),
      };
    },
  };

  /** What every request's progress shows, from its stored stages and end. */
  async function progressOf(request: StoredRequest): Promise<{
    readonly end: StoredEnd | undefined;
    readonly progress: Omit<UpdateProgress, 'routeId' | 'baseNumber'>;
  }> {
    const [stages, end] = await Promise.all([store.stages(request.id), store.end(request.id)]);
    const stalled = end === undefined && now() - request.requestedAt > updateLiveMs;
    const ended = end !== undefined || stalled;
    const next = nextUpdateStep(stages.map(asResult));
    const state = progressState(end, stalled);
    return {
      end,
      progress: {
        requestId: request.id,
        requestedAt: new Date(request.requestedAt).toISOString(),
        state,
        failure: end?.failure ?? null,
        stages: updateStages.map((stage, position) => {
          const stored = stages[position];
          if (stored !== undefined)
            return { stage, state: stored.failure === null ? 'done' : 'failed' };
          if (ended) return { stage, state: 'skipped' };
          return {
            stage,
            state: next.kind === 'run' && next.stage === stage ? 'running' : 'pending',
          };
        }),
        cost: requestCost(stages),
        lists: listCounts(end),
        contentHash: end?.failure === null ? end.proposal.contentHash : null,
        proposedNumber: end?.failure === null ? proposedNumber(end.proposal.content) : null,
      },
    };
  }
}
