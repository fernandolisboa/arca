import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
} from '@simplewebauthn/browser';
import { createPasskeys, type Passkeys } from './passkeys.js';

/** The web adapter, on the browser's WebAuthn API through SimpleWebAuthn (ADR-0015). */
export function createWebPasskeys(): Passkeys {
  return createPasskeys({
    supported: browserSupportsWebAuthn,
    autofillSupported: browserSupportsWebAuthnAutofill,
    startRegistration,
    startAuthentication,
    cancelCeremony: () => {
      WebAuthnAbortService.cancelCeremony();
    },
  });
}
