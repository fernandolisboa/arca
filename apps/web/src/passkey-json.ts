import type { PasskeyAssertion, PasskeyRequestOptions } from '@arca/api-contract/client';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@arca/platform';

/** The contract keeps transports open-ended; the browser ignores the ones it does not know. */
export function toRequestOptions(
  options: PasskeyRequestOptions,
): PublicKeyCredentialRequestOptionsJSON {
  return options as PublicKeyCredentialRequestOptionsJSON;
}

export function toAssertion(response: AuthenticationResponseJSON): PasskeyAssertion {
  return { ...response, clientExtensionResults: { ...response.clientExtensionResults } };
}
