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

export type SignInFailure = 'cancelled' | 'refused' | 'unavailable' | 'unreachable' | 'other';

/** The contract keeps transports open-ended; the browser ignores the ones it does not know. */
function toRequestOptions(options: PasskeyRequestOptions): PublicKeyCredentialRequestOptionsJSON {
  return options as PublicKeyCredentialRequestOptionsJSON;
}

function toAssertion(response: AuthenticationResponseJSON): PasskeyAssertion {
  return { ...response, clientExtensionResults: { ...response.clientExtensionResults } };
}

/** The last options request, so a new one starts only after it settled. */
let lastOptions: Promise<unknown> = Promise.resolve();

/**
 * Each options response sets the single-use challenge cookie, and the last one wins. Fetching
 * them one after another keeps an earlier, slower response from replacing a newer challenge.
 */
function nextOptions(): Promise<PasskeyRequestOptions> {
  const options = lastOptions.then(
    () => api.call(routes.passkeySignInOptions),
    () => api.call(routes.passkeySignInOptions),
  );
  lastOptions = options.catch(() => undefined);
  return options;
}

/**
 * One passkey sign-in (spec 0003, R3): fresh options with a single-use challenge, the ceremony,
 * then the assertion. With `autofill`, the ceremony waits for a pick from the account field.
 */
export async function signInWithPasskey(
  passkeys: Passkeys,
  { autofill = false, signal }: { readonly autofill?: boolean; readonly signal?: AbortSignal } = {},
): Promise<void> {
  const options = await nextOptions();
  // A screen that went away while the options loaded starts no ceremony.
  signal?.throwIfAborted();
  const response = await passkeys.get(toRequestOptions(options), { autofill });
  await api.call(routes.passkeySignIn, { response: toAssertion(response) });
}

export function failureOf(error: unknown): SignInFailure {
  if (error instanceof ApiError) return error.status === 401 ? 'refused' : 'other';
  // fetch rejects with a TypeError when the network or the server cannot be reached.
  if (error instanceof TypeError) return 'unreachable';
  // Browsers report a dismissed prompt, a timeout and a failed verification alike.
  if (error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
    return 'cancelled';
  }
  return 'other';
}
