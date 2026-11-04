import { createApiClient, routes } from '@arca/api-contract/client';
import { queryOptions } from '@tanstack/react-query';

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
