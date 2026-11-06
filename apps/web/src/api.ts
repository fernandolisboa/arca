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

/** Every route version with its decision state, for an approver only (spec 0007, R7). */
export const knowledgeVersionsQuery = queryOptions({
  queryKey: ['knowledge', 'versions'],
  queryFn: () => api.call(routes.listKnowledgeVersions),
  networkMode: 'always',
  retry: false,
});

/** One route version laid out for its approver (spec 0007, R7). */
export const versionViewQuery = (routeId: string, number: number) =>
  queryOptions({
    queryKey: ['knowledge', 'view', routeId, number],
    queryFn: () => api.call(routes.getVersionView, { routeId, number }),
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
  devicesQuery,
  vaultStatusQuery,
  notificationChannelsQuery,
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
