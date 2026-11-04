import { routes } from '@arca/api-contract/client';
import type { Passkeys } from '@arca/platform';
import { api } from './api.js';
import { toAttestation, toCreationOptions } from './passkey-json.js';
import { commonFailure, reach, type CommonFailure } from './requests.js';

/** Answers the same whether or not the address has an account (spec 0003, R6). */
export async function requestRecoveryLink(email: string): Promise<void> {
  await reach(api.call(routes.recoveryStart, { email }));
}

export type RecoveryLinkFailure = CommonFailure | 'email_unavailable';

export function recoveryLinkFailure(error: unknown): RecoveryLinkFailure {
  return commonFailure(error, ({ code }) => (code === 'email_unavailable' ? code : undefined));
}

/**
 * Spends the recovery code: the answer is the new code and the token of the registration it
 * opened, which replaces the emailed link's, so only this page can finish the recovery.
 */
export async function redeemRecoveryCode(
  token: string,
  code: string,
): Promise<{ readonly code: string; readonly token: string }> {
  return reach(api.call(routes.recoveryRedeem, { token, code }));
}

export type RedeemFailure = CommonFailure | 'expired' | 'invalid_code' | 'locked';

export function redeemFailure(error: unknown): RedeemFailure {
  return commonFailure(error, ({ code }) => {
    if (code === 'not_found') return 'expired';
    if (code === 'recovery_locked') return 'locked';
    return code === 'invalid_code' ? code : undefined;
  });
}

/** The new passkey, which waits 24 hours before it works; no session comes from it. */
export async function createRecoveryPasskey(passkeys: Passkeys, token: string): Promise<void> {
  const options = await reach(api.call(routes.recoveryOptions, { token }));
  const response = await passkeys.create(toCreationOptions(options));
  await reach(api.call(routes.recoveryVerify, { token, response: toAttestation(response) }));
}

export type RecoveryPasskeyFailure = CommonFailure | 'expired' | 'refused';

export function recoveryPasskeyFailure(error: unknown): RecoveryPasskeyFailure {
  return commonFailure(error, ({ code }) => {
    if (code === 'not_found') return 'expired';
    return code === 'passkey_refused' ? 'refused' : undefined;
  });
}
