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

/** The caller's destination comparison and their own choices for it (ADR-0026). */
export const comparisonQuery = queryOptions({
  queryKey: ['comparison'],
  queryFn: () => api.call(routes.getComparison),
  networkMode: 'always',
  retry: false,
  // Each read counts against a per-session limit, so a tab coming back into view does not read.
  refetchOnWindowFocus: false,
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

/** The live corrector key's dates, for an admin (ADR-0029). */
export const correctorKeyQuery = queryOptions({
  queryKey: ['knowledge', 'corrector-key'],
  queryFn: () => api.call(routes.getCorrectorKey),
  networkMode: 'always',
  retry: false,
});

/** How often a screen reads again while a version's independent check runs (ADR-0027). */
const checkPollMs = 15_000;

/**
 * Every route version with its decision state and check status, for an admin only (spec 0007,
 * R7), read again while a check runs.
 */
export const knowledgeVersionsQuery = queryOptions({
  queryKey: ['knowledge', 'versions'],
  queryFn: () => api.call(routes.listKnowledgeVersions),
  networkMode: 'always',
  retry: false,
  refetchInterval: ({ state }) =>
    state.data?.versions.some(({ check }) => check === 'running') === true ? checkPollMs : false,
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
/** One route version's independent check and its current report, read again while it runs. */
export const versionCheckQuery = (routeId: string, number: number) =>
  queryOptions({
    queryKey: ['knowledge', 'check', routeId, number],
    queryFn: () => api.call(routes.getVersionCheck, { routeId, number }),
    networkMode: 'always',
    retry: false,
    refetchInterval: ({ state }) => (state.data?.status === 'running' ? checkPollMs : false),
  });

/** How often the progress of a running check is read again (ADR-0027, "On demand, with progress"). */
const checkProgressPollMs = 1_500;

/** How far one route version's newest check got, read again while it runs. */
export const checkProgressQuery = (routeId: string, number: number) =>
  queryOptions({
    queryKey: ['knowledge', 'check-progress', routeId, number],
    queryFn: () => api.call(routes.getVersionCheckProgress, { routeId, number }),
    networkMode: 'always',
    retry: false,
    refetchInterval: ({ state }) =>
      state.data?.progress?.state === 'running' ? checkProgressPollMs : false,
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
