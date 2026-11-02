import { createApiClient, routes } from '@arca/api-contract/client';
import { queryOptions } from '@tanstack/react-query';

/** The web build talks to the API on its own origin (spec 0001, R4). */
const api = createApiClient({ origin: '' });

export const healthQuery = queryOptions({
  queryKey: ['health'],
  queryFn: () => api.call(routes.health),
  // Report an unreachable API instead of pausing while the device is offline.
  networkMode: 'always',
  retry: 1,
});
