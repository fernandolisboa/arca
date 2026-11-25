import { createApiClient, routes } from '@arca/api-contract/client';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { forgetPush } from './push-device.js';
import { forgetVault } from './vault-guard.js';

/** The web build talks to the API on its own origin (spec 0001, R4). */
export const api = createApiClient({ origin: '' });

export const healthQuery = queryOptions({
  queryKey: ['health'],
  queryFn: () => api.call(routes.health),
  // Report an unreachable API instead of pausing while the device is offline.
  networkMode: 'always',
  retry: 1,
});

/** The signed-in session; a 401 means there is none, so it is never retried. */
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: () => api.call(routes.session),
  networkMode: 'always',
  retry: false,
});

/** Whether the signed-in account has a recovery kit, and whether it was saved (spec 0003, R6). */
export const recoveryKitQuery = queryOptions({
  queryKey: ['recovery-kit'],
  queryFn: () => api.call(routes.recoveryKitStatus),
  networkMode: 'always',
  retry: false,
});

/** The signed-in account's invites, open, accepted or confirmed (spec 0003, R2). */
export const invitesQuery = queryOptions({
  queryKey: ['invites'],
  queryFn: () => api.call(routes.listInvites),
  networkMode: 'always',
  retry: false,
});

/** The family's case as the account sees it, null before it is in one (spec 0007, R3). */
export const caseQuery = queryOptions({
  queryKey: ['case'],
  queryFn: () => api.call(routes.getCase),
  networkMode: 'always',
  retry: false,
});

/** The guided questions of the people the account keeps, with their answers (spec 0007, R4). */
export const caseQuestionsQuery = queryOptions({
  queryKey: ['case', 'questions'],
  queryFn: () => api.call(routes.getCaseQuestions),
  networkMode: 'always',
  retry: false,
});

/** The case read back as sentences (spec 0007, R5). */
export const casePlaybackQuery = queryOptions({
  queryKey: ['case', 'playback'],
  queryFn: () => api.call(routes.getCasePlayback),
  networkMode: 'always',
  retry: false,
  // Each read counts against a per-session limit, so a tab coming back into view does not read.
  refetchOnWindowFocus: false,
});

/** Every route for each member of the case, with the questions that change an answer (R6). */
export const caseEvaluationsQuery = queryOptions({
  queryKey: ['case', 'evaluations'],
  queryFn: () => api.call(routes.getCaseEvaluations),
  networkMode: 'always',
  retry: false,
  // Each read counts against a per-session limit, so a tab coming back into view does not read.
  refetchOnWindowFocus: false,
});

/** One route's document checklist for a member as principal (spec #519). */
/** Every principal's checklist of one route, which a mark on it changes. */
export const routeDocumentsKey = (routeId: string) => ['case', 'documents', routeId] as const;

export const routeDocumentsQuery = (routeId: string, principalId: string) =>
  queryOptions({
    queryKey: [...routeDocumentsKey(routeId), principalId],
    queryFn: () => api.call(routes.getRouteDocuments, { routeId, principalId }),
    networkMode: 'always',
    retry: false,
    // Each read counts against a per-session limit, so a tab coming back into view does not read.
    refetchOnWindowFocus: false,
  });

/** The caller's destination comparison and their own choices for it (ADR-0026). */
export const comparisonQuery = queryOptions({
  queryKey: ['comparison'],
  queryFn: () => api.call(routes.getComparison),
  networkMode: 'always',
  retry: false,
  // Each read counts against a per-session limit, so a tab coming back into view does not read.
  refetchOnWindowFocus: false,
});

/** The case's family plan, each move evaluated with only the people it takes (ADR-0040). */
export const familyPlanQuery = queryOptions({
  queryKey: ['case', 'plan'],
  queryFn: () => api.call(routes.getFamilyPlan),
  networkMode: 'always',
  retry: false,
  // Each read counts against a per-session limit, so a tab coming back into view does not read.
  refetchOnWindowFocus: false,
});

/** What to do when leaving a country, with official sources (ADR-0038): public, rarely changed. */
export const departureChecklistsQuery = queryOptions({
  queryKey: ['departure-checklists'],
  queryFn: () => api.call(routes.getDepartureChecklists),
  networkMode: 'always',
  retry: false,
  staleTime: Infinity,
});

/**
 * How a profession is recognised abroad, with official sources (ADR-0041), and whom in the case
 * each track concerns, which changes as the family's answers do.
 */
export const recognitionTracksQuery = queryOptions({
  queryKey: ['case', 'recognition-tracks'],
  queryFn: () => api.call(routes.getRecognitionTracks),
  networkMode: 'always',
  retry: false,
});

/** The account's passkeys, each with its sessions (spec 0003, R4). */
export const devicesQuery = queryOptions({
  queryKey: ['devices'],
  queryFn: () => api.call(routes.listDevices),
  networkMode: 'always',
  retry: false,
});

/** Whether the account's vault is set up, and whether it needs a new recovery secret (spec 0005, R2). */
export const vaultStatusQuery = queryOptions({
  queryKey: ['vault'],
  queryFn: () => api.call(routes.vaultStatus),
  networkMode: 'always',
  retry: false,
});

/** The account's notification channels and the environment's push key (spec 0005, R7). */
export const notificationChannelsQuery = queryOptions({
  queryKey: ['notification-channels'],
  queryFn: () => api.call(routes.notificationChannels),
  networkMode: 'always',
  retry: false,
});

/** The open reports of possibly wrong requirements, for an admin (spec 0007, R8). */
export const ruleReportsQuery = queryOptions({
  queryKey: ['knowledge', 'reports'],
  queryFn: () => api.call(routes.listRuleReports),
  networkMode: 'always',
  retry: false,
});

/** One route version's correction requests, for an admin (ADR-0029). */
export const correctionRequestsQuery = (routeId: string, number: number) =>
  queryOptions({
    queryKey: ['knowledge', 'corrections', routeId, number],
    queryFn: () => api.call(routes.listCorrectionRequests, { routeId, number }),
    networkMode: 'always',
    retry: false,
  });

/** The signed-in account's own update requests and their state (ADR-0031, #462). */
export const ownUpdateRequestsQuery = queryOptions({
  queryKey: ['knowledge', 'own-update-requests'],
  queryFn: () => api.call(routes.getOwnUpdateRequests),
  networkMode: 'always',
  retry: false,
});

/** The newest members' update requests, for an admin to release or decline (ADR-0031, #462). */
export const memberUpdateRequestsQuery = queryOptions({
  queryKey: ['knowledge', 'member-update-requests'],
  queryFn: () => api.call(routes.getMemberUpdateRequests),
  networkMode: 'always',
  retry: false,
});

/** Every request for a new route, and the countries one may name (ADR-0029, new routes). */
export const routeRequestsQuery = queryOptions({
  queryKey: ['knowledge', 'route-requests'],
  queryFn: () => api.call(routes.listRouteRequests),
  networkMode: 'always',
  retry: false,
});

/** Configurações › IA, for an admin (ADR-0031): key states, never a key, and stage models. */
export const aiSettingsQuery = queryOptions({
  queryKey: ['settings', 'ai'],
  queryFn: () => api.call(routes.getAiSettings),
  networkMode: 'always',
  retry: false,
});

/** Every route version with its decision state, for an admin only (spec 0007, R7). */
export const knowledgeVersionsQuery = queryOptions({
  queryKey: ['knowledge', 'versions'],
  queryFn: () => api.call(routes.listKnowledgeVersions),
  networkMode: 'always',
  retry: false,
});

/** One comparison version laid out for an admin (ADR-0026). */
export const comparisonViewQuery = (comparisonId: string, number: number) =>
  queryOptions({
    queryKey: ['knowledge', 'comparison', comparisonId, number],
    queryFn: () => api.call(routes.getComparisonView, { comparisonId, number }),
    networkMode: 'always',
    retry: false,
  });

/** One route version laid out for an admin (spec 0007, R7). */
export const versionViewQuery = (routeId: string, number: number) =>
  queryOptions({
    queryKey: ['knowledge', 'view', routeId, number],
    queryFn: () => api.call(routes.getVersionView, { routeId, number }),
    networkMode: 'always',
    retry: false,
  });

/** Which members of the case are admins, for an admin only (ADR-0027). */
export const caseAdminsQuery = queryOptions({
  queryKey: ['admins'],
  queryFn: () => api.call(routes.listCaseAdmins),
  networkMode: 'always',
  retry: false,
});
/** How often a running update request's progress is read again (ADR-0031). */
const updatePollMs = 3_000;

/** A route's newest update request with its progress by stage, read again while it runs. */
export const updateRequestQuery = (routeId: string) =>
  queryOptions({
    queryKey: ['knowledge', 'update-request', routeId],
    queryFn: () => api.call(routes.getNewestUpdateRequest, { routeId }),
    networkMode: 'always',
    retry: false,
    refetchInterval: ({ state }) =>
      state.data?.request?.state === 'running' ? updatePollMs : false,
  });

/** The newest new-route requests with their progress, read again while one runs (ADR-0031). */
export const newRouteRequestsQuery = queryOptions({
  queryKey: ['knowledge', 'new-route-requests'],
  queryFn: () => api.call(routes.getNewRouteRequests),
  networkMode: 'always',
  retry: false,
  refetchInterval: ({ state }) =>
    state.data?.requests.some((request) => request.state === 'running') === true
      ? updatePollMs
      : false,
});

/** One route version's three lists, hand edits marked, and the items an admin may edit (ADR-0031). */
export const versionReviewQuery = (routeId: string, number: number) =>
  queryOptions({
    queryKey: ['knowledge', 'review', routeId, number],
    queryFn: () => api.call(routes.getVersionReview, { routeId, number }),
    networkMode: 'always',
    retry: false,
  });

/**
 * Everything cached for one account, the session first; a new query that is the account's own
 * joins this list.
 */
const accountQueries = [
  sessionQuery,
  recoveryKitQuery,
  invitesQuery,
  caseQuery,
  comparisonQuery,
  devicesQuery,
  vaultStatusQuery,
  notificationChannelsQuery,
  caseAdminsQuery,
  { queryKey: ['knowledge'] },
  // The vault's documents, whatever identity opened them (documents.ts).
  { queryKey: ['documents'] },
];

/**
 * After a sign-in, a registration or a sign-out, nothing cached for the previous account may
 * show: reset, not invalidated, so no screen renders the old data while the new one loads. Its
 * vault closes and is forgotten on this device, and its push subscription ends.
 */
export async function resetAccount(queryClient: QueryClient): Promise<void> {
  try {
    await Promise.all([forgetVault(), forgetPush()]);
  } finally {
    // Only the session is fetched again; the rest goes, so a screen still open fetches its own
    // list after the session answers, never with the old one's cookie gone.
    for (const { queryKey } of accountQueries.slice(1)) queryClient.removeQueries({ queryKey });
    await queryClient.resetQueries({ queryKey: sessionQuery.queryKey });
  }
}
