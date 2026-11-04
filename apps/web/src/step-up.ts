import {
  routes,
  stepUpNonceHeader,
  type StepUpAction,
  type StepUpOptionsRequest,
  type StepUpPurpose,
} from '@arca/api-contract/client';
import type { Passkeys } from '@arca/platform';
import { api } from './api.js';
import { base64url } from './base64url.js';
import { toAssertion, toRequestOptions } from './passkey-json.js';
import { reach } from './requests.js';

/** Options, the passkey ceremony and verify; returns the credential ID the person approved with. */
async function verifyStepUp(passkeys: Passkeys, request: StepUpOptionsRequest): Promise<string> {
  const { challengeId, options } = await reach(api.call(routes.stepUpOptions, request));
  const response = await passkeys.get(toRequestOptions(options));
  await reach(api.call(routes.stepUpVerify, { challengeId, response: toAssertion(response) }));
  return response.id;
}

/**
 * A step-up for one action (spec 0003, R5), `sensitive_settings` unless named: a fresh 128-bit
 * nonce, options bound to the action, the passkey ceremony and verify. Returns the client that
 * sends the nonce with the action itself, which the server then lets run once.
 */
export async function stepUpFor(
  passkeys: Passkeys,
  action: Omit<StepUpAction, 'nonce'>,
  purpose: Exclude<StepUpPurpose, 'vault_unlock'> = 'sensitive_settings',
): Promise<ReturnType<typeof api.withHeaders>> {
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  await verifyStepUp(passkeys, { purpose, target: { ...action, nonce } });
  return api.withHeaders({ [stepUpNonceHeader]: nonce });
}

/**
 * Opens this session's 15-minute `vault_unlock` window (spec 0005, R2) and returns the passkey
 * that opened it, whose envelope the device then opens.
 */
export function openVaultWindow(passkeys: Passkeys): Promise<string> {
  return verifyStepUp(passkeys, { purpose: 'vault_unlock' });
}
