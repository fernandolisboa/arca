import { randomBytes, randomUUID } from 'node:crypto';
import type { StepUpOptionsRequest } from '@arca/api-contract/routes';
import type { SignedIn } from '../../src/auth/service.js';
import type { StepUpService } from '../../src/auth/step-up.js';
import type { CanonicalAction } from '../../src/auth/step-up-encoding.js';
import { softwarePasskey, type SoftwarePasskey } from '../software-passkey.js';
import type { AuthTestDatabase } from './auth-database.js';

// Synthetic accounts, passkeys and sessions for step-up tests on the real migrations.
export const origin = 'http://localhost:3000';
export const rpId = 'localhost';

export interface Person {
  readonly signedIn: SignedIn;
  readonly passkey: SoftwarePasskey;
}

export async function addPasskey(
  testDatabase: AuthTestDatabase,
  accountId: string,
  passkey: SoftwarePasskey,
) {
  await testDatabase.asAdmin((client) =>
    client.query(
      `INSERT INTO auth.passkey (public_key, user_id, credential_id, counter, device_type, backed_up)
       VALUES ($1, $2, $3, 0, 'multiDevice', true)`,
      [passkey.publicKey, accountId, passkey.credentialId],
    ),
  );
}

/** An account with one passkey and a session it signed in, seeded as Better Auth stores them. */
export async function person(testDatabase: AuthTestDatabase): Promise<Person> {
  const accountId = randomUUID();
  const sessionId = randomUUID();
  const passkey = softwarePasskey(rpId);
  await testDatabase.asAdmin(async (client) => {
    await client.query(`INSERT INTO auth.user (id, name, email) VALUES ($1, '', $2)`, [
      accountId,
      `${accountId}@example.com`,
    ]);
    await addPasskey(testDatabase, accountId, passkey);
    await client.query(
      `INSERT INTO auth.session (id, expires_at, token, user_id, device_browser, device_os, credential_id)
       VALUES ($1, now() + interval '1 day', $2, $3, 'firefox', 'linux', $4)`,
      [sessionId, randomBytes(16).toString('hex'), accountId, passkey.credentialId],
    );
  });
  return { signedIn: { accountId, sessionId }, passkey };
}

export const toRequest = (
  purpose: Exclude<StepUpOptionsRequest['purpose'], 'vault_unlock'>,
  action: CanonicalAction,
): StepUpOptionsRequest => ({
  purpose,
  target: {
    action: action.action,
    targets: [...action.targets],
    ...(action.fields === undefined ? {} : { fields: { ...action.fields } }),
    nonce: Buffer.from(action.nonce).toString('base64url'),
  },
});

export interface Ceremony {
  readonly signer?: SoftwarePasskey;
  readonly verifiedBy?: SignedIn;
  readonly userVerified?: boolean;
}

/** Options, then a signed assertion, then verify; returns whether verify accepted it. */
export async function ceremony(
  stepUp: StepUpService,
  owner: Person,
  request: StepUpOptionsRequest,
  { signer = owner.passkey, verifiedBy = owner.signedIn, userVerified = true }: Ceremony = {},
) {
  const { challengeId, options } = await stepUp.options(owner.signedIn, request);
  const response = signer.assert({ challenge: options.challenge, origin, userVerified });
  return {
    challengeId,
    response,
    verified: await stepUp.verify(verifiedBy, challengeId, response),
  };
}
