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

export type SignInFailure =
  'cancelled' | 'refused' | 'limited' | 'unavailable' | 'unreachable' | 'other';

/** The contract keeps transports open-ended; the browser ignores the ones it does not know. */
function toRequestOptions(options: PasskeyRequestOptions): PublicKeyCredentialRequestOptionsJSON {
  return options as PublicKeyCredentialRequestOptionsJSON;
}

function toAssertion(response: AuthenticationResponseJSON): PasskeyAssertion {
  return { ...response, clientExtensionResults: { ...response.clientExtensionResults } };
}

/** The API could not be reached: fetch rejected before any response arrived. */
class UnreachableError extends Error {
  override name = 'UnreachableError';
}

/** Tells a failed fetch apart from any other TypeError, such as malformed ceremony options. */
async function reach<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    throw error instanceof TypeError
      ? new UnreachableError(error.message, { cause: error })
      : error;
  }
}

/** The last options request, so a new one starts only after it settled. */
let lastOptions: Promise<unknown> = Promise.resolve();

/** A stalled request delays the next one by at most this long. */
const optionsQueueLimitMs = 10_000;

/**
 * Each options response sets the single-use challenge cookie, and the last one wins. Fetching
 * them one after another keeps an earlier, slower response from replacing a newer challenge.
 */
function nextOptions(): Promise<PasskeyRequestOptions> {
  const previous = Promise.race([
    lastOptions,
    new Promise((resolve) => setTimeout(resolve, optionsQueueLimitMs)),
  ]);
  const options = previous.then(() => reach(api.call(routes.passkeySignInOptions)));
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
  await reach(api.call(routes.passkeySignIn, { response: toAssertion(response) }));
}

export function failureOf(error: unknown): SignInFailure {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'refused';
    return error.status === 429 ? 'limited' : 'other';
  }
  if (error instanceof UnreachableError) return 'unreachable';
  // Browsers report a dismissed prompt, a timeout and a failed verification alike.
  if (error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
    return 'cancelled';
  }
  return 'other';
}
