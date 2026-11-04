import { randomBytes } from 'node:crypto';
import { PasskeyCreationOptions, type PasskeyAttestation } from '@arca/api-contract/routes';
import type { Database } from '@arca/db';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { accounts, devices, passkeyRegistration, type NewPasskey } from './auth.js';

const challengeTimeoutMs = 2 * 60 * 1000;

/**
 * Registering another passkey for an existing account, from a signed-in session or a recovery
 * (spec 0003, R4, R6): the same options and checks as the first registration, with the caller
 * holding the challenge.
 */
export interface PasskeyCreation {
  /** Options for this challenge; throws when the account is gone. */
  readonly options: (accountId: string, challenge: Uint8Array) => Promise<PasskeyCreationOptions>;
  /** The verified passkey, or null for every refusal alike. */
  readonly verify: (
    response: PasskeyAttestation,
    challenge: Uint8Array,
  ) => Promise<NewPasskey | null>;
}

export function passkeyCreation({
  db,
  origin,
}: {
  /** A database on the app_auth pool. */
  readonly db: Database;
  /** The environment's own origin; its host is the relying-party ID (spec 0003, R9). */
  readonly origin: string;
}): PasskeyCreation {
  const rpId = new URL(origin).hostname;
  return {
    options: async (accountId, challenge) => {
      const email = await accounts.emailOf(db, accountId);
      if (email === undefined) throw new Error('the account is gone');
      const options = await generateRegistrationOptions({
        rpName: passkeyRegistration.rpName,
        rpID: rpId,
        userName: email,
        userDisplayName: email,
        // A fresh handle, like the passkey plugin's: nothing about the account goes in it.
        userID: new Uint8Array(randomBytes(32)),
        challenge: new Uint8Array(challenge),
        timeout: challengeTimeoutMs,
        attestationType: 'none',
        // The browser ignores the transports it does not know.
        excludeCredentials: (await devices.credentialsOf(db, accountId)).map(
          ({ id, transports }) => ({
            id,
            transports: transports as AuthenticatorTransportFuture[],
          }),
        ),
        authenticatorSelection: passkeyRegistration.authenticatorSelection,
        extensions: passkeyRegistration.extensions,
      });
      // SimpleWebAuthn adds credProps, which Arca never reads; only the empty PRF request stays.
      return PasskeyCreationOptions.parse({ ...options, extensions: { prf: {} } });
    },

    verify: async (response, challenge) => {
      try {
        const { verified, registrationInfo } = await verifyRegistrationResponse({
          response: response as RegistrationResponseJSON,
          expectedChallenge: Buffer.from(challenge).toString('base64url'),
          expectedOrigin: origin,
          expectedRPID: rpId,
          requireUserVerification: true,
        });
        if (!verified) return null;
        return {
          credentialId: registrationInfo.credential.id,
          publicKey: Buffer.from(registrationInfo.credential.publicKey).toString('base64'),
          counter: registrationInfo.credential.counter,
          deviceType: registrationInfo.credentialDeviceType,
          backedUp: registrationInfo.credentialBackedUp,
          transports: response.response.transports ?? [],
          aaguid: registrationInfo.aaguid,
          prfEnabled: response.clientExtensionResults.prf?.enabled === true,
        };
      } catch {
        return null;
      }
    },
  };
}
