import {
  ApiError,
  routes,
  type PasskeyAssertion,
  type PasskeyRequestOptions,
} from '@arca/api-contract/client';
import type {
  AuthenticationResponseJSON,
  Passkeys,
  PublicKeyCredentialRequestOptionsJSON,
} from '@arca/platform';
import { api } from './api.js';

export type SignInFailure = 'cancelled' | 'refused' | 'unavailable' | 'other';

/** The contract keeps transports open-ended; the browser ignores the ones it does not know. */
function toRequestOptions(options: PasskeyRequestOptions): PublicKeyCredentialRequestOptionsJSON {
  return options as PublicKeyCredentialRequestOptionsJSON;
}

function toAssertion(response: AuthenticationResponseJSON): PasskeyAssertion {
  return { ...response, clientExtensionResults: { ...response.clientExtensionResults } };
}

/**
 * One passkey sign-in (spec 0003, R3): fresh options with a single-use challenge, the ceremony,
 * then the assertion. With `autofill`, the ceremony waits for a pick from the account field.
 */
export async function signInWithPasskey(
  passkeys: Passkeys,
  { autofill = false, signal }: { readonly autofill?: boolean; readonly signal?: AbortSignal } = {},
): Promise<void> {
  const options = await api.call(routes.passkeySignInOptions);
  // A screen that went away while the options loaded starts no ceremony.
  signal?.throwIfAborted();
  const response = await passkeys.get(toRequestOptions(options), { autofill });
  await api.call(routes.passkeySignIn, { response: toAssertion(response) });
}

/** Whether a failed ceremony was only ended by the app, such as autofill giving way to the button. */
export function wasAborted(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function failureOf(error: unknown): SignInFailure {
  if (error instanceof ApiError) return error.status === 401 ? 'refused' : 'other';
  // Browsers report a dismissed prompt and a timed-out one alike, so both read as cancelled.
  if (error instanceof Error && error.name === 'NotAllowedError') return 'cancelled';
  return 'other';
}
