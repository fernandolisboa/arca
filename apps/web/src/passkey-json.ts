import type {
  PasskeyAssertion,
  PasskeyAttestation,
  PasskeyCreationOptions,
  PasskeyRequestOptions,
} from '@arca/api-contract/client';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
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

export function toCreationOptions(
  options: PasskeyCreationOptions,
): PublicKeyCredentialCreationOptionsJSON {
  return options as PublicKeyCredentialCreationOptionsJSON;
}

/** The Passkeys port keeps only `prf.enabled` among the results, which the contract checks. */
export function toAttestation(response: RegistrationResponseJSON): PasskeyAttestation {
  return {
    ...response,
    clientExtensionResults:
      response.clientExtensionResults as PasskeyAttestation['clientExtensionResults'],
  };
}
