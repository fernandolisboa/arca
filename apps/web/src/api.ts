import { createApiClient, routes } from '@arca/api-contract/client';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
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

/** Everything cached for one account; a new query that is the account's own joins this list. */
const accountQueries = [
  sessionQuery,
  recoveryKitQuery,
  invitesQuery,
  devicesQuery,
  vaultStatusQuery,
];

/**
 * After a sign-in, a registration or a sign-out, nothing cached for the previous account may
 * show: reset, not invalidated, so no screen renders the old data while the new one loads. Its
 * vault closes and is forgotten on this device too.
 */
export async function resetAccount(queryClient: QueryClient): Promise<void> {
  try {
    await forgetVault();
  } finally {
    await Promise.all(accountQueries.map(({ queryKey }) => queryClient.resetQueries({ queryKey })));
  }
}
