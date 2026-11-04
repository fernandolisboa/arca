import { createWebVaultEnvelopes } from '@arca/platform';
import { keyStorage, passkeys } from './platform.js';
import type { VaultDevice } from './vault.js';

/**
 * The vault's web adapters, loaded with the vault screen only. The relying-party ID is the host,
 * as the API derives it from the same origin (ADR-0015).
 */
export const vaultDevice: VaultDevice = {
  passkeys,
  envelopes: createWebVaultEnvelopes(location.hostname),
  keyStorage,
  relyingPartyId: location.hostname,
};
