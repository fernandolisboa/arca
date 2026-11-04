import {
  routes,
  stepUpNonceHeader,
  type StepUpAction,
  type StepUpPurpose,
} from '@arca/api-contract/client';
import type { Passkeys } from '@arca/platform';
import { api } from './api.js';
import { toAssertion, toRequestOptions } from './passkey-json.js';
import { reach } from './requests.js';

/** Bytes as base64url without padding, as the contract carries them. */
export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * A step-up for one action (spec 0003, R5), `sensitive_settings` unless named: a fresh 128-bit nonce, options
 * bound to the action, the passkey ceremony and verify. Returns the client that sends the nonce
 * with the action itself, which the server then lets run once.
 */
export async function stepUpFor(
  passkeys: Passkeys,
  action: Omit<StepUpAction, 'nonce'>,
  purpose: Exclude<StepUpPurpose, 'vault_unlock'> = 'sensitive_settings',
): Promise<ReturnType<typeof api.withHeaders>> {
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const { challengeId, options } = await reach(
    api.call(routes.stepUpOptions, { purpose, target: { ...action, nonce } }),
  );
  const response = await passkeys.get(toRequestOptions(options));
  await reach(api.call(routes.stepUpVerify, { challengeId, response: toAssertion(response) }));
  return api.withHeaders({ [stepUpNonceHeader]: nonce });
}
