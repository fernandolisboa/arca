/** Whose secret a stored blob is: a blob opens only for the account and relying party it was stored for. */
export interface KeyContext {
  readonly accountId: string;
  readonly relyingPartyId: string;
}

export type StoredSecret =
  | { readonly status: 'stored'; readonly secret: Uint8Array }
  /** Never stored, evicted by the system, or stored for another account or relying party. */
  | { readonly status: 'not stored' };

/**
 * Keeps one secret on this device, wrapped by a key the device will not export, so the vault
 * identity survives a reload without a passkey ceremony (spec 0005, R5).
 */
export interface KeyStorage {
  /** Replaces any stored secret. `not stored` when the device refuses to keep it. */
  store(context: KeyContext, secret: Uint8Array): Promise<'stored' | 'not stored'>;
  load(context: KeyContext): Promise<StoredSecret>;
  /** Deletes the secret and its key: on sign-out, account change, recovery and revocation. */
  forget(): Promise<void>;
}
