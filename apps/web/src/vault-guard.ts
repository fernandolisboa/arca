import { ApiError } from '@arca/api-contract/client';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { keyStorage } from './platform.js';
import { forgetPush } from './push-device.js';
import { lockVault, watchVaultActivity } from './vault-session.js';

/**
 * Closes the vault and deletes the identity wrapped on this device: on sign-out, an account
 * change, recovery and a session found revoked (ADR-0018; spec 0005, R5).
 */
export async function forgetVault(): Promise<void> {
  lockVault();
  await keyStorage?.forget();
}

/**
 * Wires the vault's closing rules into the page: activity and visibility restart its 15 minutes,
 * leaving the page closes it, and a signed-in session that turns into a 401 forgets it, with this
 * browser's push subscription.
 */
export function guardVault(page: Window, queryClient: QueryClient, sessionKey: QueryKey): void {
  watchVaultActivity(page);
  page.addEventListener('pagehide', lockVault);
  let signedIn = false;
  queryClient.getQueryCache().subscribe(({ query }) => {
    if (JSON.stringify(query.queryKey) !== JSON.stringify(sessionKey)) return;
    const { status } = query.state;
    const error: unknown = query.state.error;
    if (status === 'success') {
      signedIn = true;
    } else if (signedIn && error instanceof ApiError && error.status === 401) {
      signedIn = false;
      void forgetVault();
      void forgetPush();
    }
  });
}
