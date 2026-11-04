import { randomBytes } from 'node:crypto';
import {
  DeviceDescription,
  PasskeyCreationOptions,
  type AddPasskeyOptionsResponse,
  type DevicePasskey,
  type DevicesResponse,
  type PasskeyAttestation,
} from '@arca/api-contract/routes';
import type { Database } from '@arca/db';
import { passkeyChallenge as challenge } from '@arca/db/enrollment-schema';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { and, eq, lte, sql } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';
import type { NoticeKind, Notices } from '../email/notices.js';
import type { Logger } from '../logger.js';
import { accounts, devices, passkeyRegistration } from './auth.js';
import { absoluteSessionLifetimeMs, type SignedIn } from './service.js';
import { forgetUnspent } from './step-up.js';

export type PasskeyRevocation = 'revoked' | 'not_found' | 'last_active';

/**
 * The device list, its revocations and adding a passkey (spec 0003, R4); each route that needs a
 * step-up spends it before calling these.
 */
export interface Devices {
  readonly list: (signedIn: SignedIn) => Promise<DevicesResponse>;
  /** False when the session is not the account's. */
  readonly revokeSession: (signedIn: SignedIn, sessionId: string) => Promise<boolean>;
  /** Revokes an active passkey, or cancels a pending one. */
  readonly revokePasskey: (signedIn: SignedIn, passkeyId: string) => Promise<PasskeyRevocation>;
  readonly revokeOtherSessions: (signedIn: SignedIn) => Promise<void>;
  readonly addOptions: (signedIn: SignedIn) => Promise<AddPasskeyOptionsResponse>;
  /** False for every refusal alike, so a caller learns nothing about why. */
  readonly add: (
    signedIn: SignedIn,
    challengeId: string,
    response: PasskeyAttestation,
  ) => Promise<boolean>;
  /**
   * When the account's newest pending passkey becomes active, or null; a wait that is over is
   * recorded as the passkey's activation first.
   */
  readonly pendingUntil: (accountId: string) => Promise<Date | null>;
}

export interface DeviceSettings {
  /** A database on the app_auth pool. */
  readonly db: Database;
  readonly audit: AuditLog;
  readonly notices: Notices;
  readonly logger: Logger;
  /** The environment's own origin; its host is the relying-party ID (spec 0003, R9). */
  readonly origin: string;
  readonly clock?: () => Date;
}

const challengeTimeoutMs = 2 * 60 * 1000;

export function createDevices({
  db,
  audit,
  notices,
  logger,
  origin,
  clock = () => new Date(),
}: DeviceSettings): Devices {
  const rpId = new URL(origin).hostname;

  /** A notice that fails to send never undoes the change; the failure is logged. */
  async function notify(
    accountId: string,
    kind: Extract<
      NoticeKind,
      'passkey_added' | 'passkey_revoked' | 'pending_passkey_cancelled' | 'sessions_revoked'
    >,
  ) {
    try {
      const to = await accounts.emailOf(db, accountId);
      if (to !== undefined) await notices.send({ kind, to, at: clock() });
    } catch (error) {
      logger.error({
        errorName: `DeviceNotice:${error instanceof Error ? error.name : 'NonErrorThrown'}`,
      });
    }
  }

  /** Sessions created before this are past their absolute lifetime (spec 0003, R4). */
  const liveSince = () => new Date(clock().getTime() - absoluteSessionLifetimeMs);

  const sessionRevoked = (accountId: string, sessionId: string) =>
    audit.record({
      code: 'session_revoked',
      subjectAccountId: accountId,
      actorAccountId: accountId,
      details: { sessionId },
    });

  /** Each wait that is over becomes a `passkey activated` event, recorded before the commit. */
  const activateDue = (accountId: string) =>
    db.transaction(async (tx) => {
      for (const passkeyId of await devices.activateDue(tx, accountId)) {
        await audit.record({
          code: 'passkey_activated',
          subjectAccountId: accountId,
          actorAccountId: null,
          details: { passkeyId },
        });
      }
    });

  return {
    list: async ({ accountId, sessionId }) => {
      await activateDue(accountId);
      const { passkeys, sessions } = await devices.of(db, accountId, liveSince());
      return {
        passkeys: passkeys.map(({ id, credentialId, createdAt, pendingUntil }): DevicePasskey => {
          const signed = sessions
            .filter((session) => session.credentialId === credentialId)
            .map((session) => ({
              id: session.id,
              // Parsed, so a stored value outside the enums fails loudly instead of reaching a
              // client.
              device: DeviceDescription.parse({ browser: session.browser, os: session.os }),
              createdAt: session.createdAt.toISOString(),
              lastUsedAt: session.updatedAt.toISOString(),
              current: session.id === sessionId,
            }));
          return {
            id,
            createdAt: createdAt?.toISOString() ?? null,
            current: signed.some(({ current }) => current),
            state: pendingUntil === null ? 'active' : 'pending',
            activeFrom: pendingUntil?.toISOString() ?? null,
            sessions: signed,
          };
        }),
      };
    },

    // Recorded before the commit, like every security event: a failed write keeps the session.
    revokeSession: ({ accountId }, sessionId) =>
      db.transaction(async (tx) => {
        if (!(await devices.revokeSession(tx, accountId, sessionId))) return false;
        await sessionRevoked(accountId, sessionId);
        return true;
      }),

    revokePasskey: async ({ accountId }, passkeyId) => {
      const outcome = await db.transaction(async (tx) => {
        const revoked = await devices.revokePasskey(tx, accountId, passkeyId);
        if (typeof revoked === 'string') return revoked;
        await forgetUnspent(tx, accountId, revoked.credentialId);
        await audit.record({
          code: 'passkey_revoked',
          subjectAccountId: accountId,
          actorAccountId: accountId,
          details: { passkeyId },
        });
        return revoked.pending ? 'cancelled' : 'revoked';
      });
      if (outcome === 'cancelled') {
        await notify(accountId, 'pending_passkey_cancelled');
        return 'revoked';
      }
      if (outcome === 'revoked') await notify(accountId, 'passkey_revoked');
      return outcome;
    },

    revokeOtherSessions: async ({ accountId, sessionId }) => {
      const ended = await db.transaction(async (tx) => {
        const ids = await devices.revokeOtherSessions(tx, accountId, sessionId, liveSince());
        for (const id of ids) await sessionRevoked(accountId, id);
        return ids.length;
      });
      if (ended > 0) await notify(accountId, 'sessions_revoked');
    },

    addOptions: async ({ accountId, sessionId }) => {
      // Expired challenges are swept here, so the table stays bounded by one lifetime's worth.
      await db.delete(challenge).where(lte(challenge.expiresAt, sql`now()`));
      const email = await accounts.emailOf(db, accountId);
      if (email === undefined) throw new Error('the signed-in account is gone');
      const value = randomBytes(32);
      const [issued] = await db
        .insert(challenge)
        .values({ accountId, sessionId, challenge: value })
        .returning({ id: challenge.id });
      if (issued === undefined) throw new Error('the challenge was not stored');
      const options = await generateRegistrationOptions({
        rpName: passkeyRegistration.rpName,
        rpID: rpId,
        userName: email,
        userDisplayName: email,
        // A fresh handle, like the passkey plugin's: nothing about the account goes in it.
        userID: new Uint8Array(randomBytes(32)),
        challenge: new Uint8Array(value),
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
      return {
        challengeId: issued.id,
        options: PasskeyCreationOptions.parse({ ...options, extensions: { prf: {} } }),
      };
    },

    add: async ({ accountId, sessionId }, challengeId, response) => {
      // Consumed before verification, so a challenge is spent by its first attempt, good or not.
      const [issued] = await db
        .delete(challenge)
        .where(
          and(
            eq(challenge.id, challengeId),
            eq(challenge.sessionId, sessionId),
            eq(challenge.accountId, accountId),
          ),
        )
        .returning({
          challenge: challenge.challenge,
          live: sql<boolean>`${challenge.expiresAt} > now()`,
        });
      if (issued?.live !== true) return false;
      let registered;
      try {
        const verification = await verifyRegistrationResponse({
          response: response as RegistrationResponseJSON,
          expectedChallenge: Buffer.from(issued.challenge).toString('base64url'),
          expectedOrigin: origin,
          expectedRPID: rpId,
          requireUserVerification: true,
        });
        if (!verification.verified) return false;
        registered = verification.registrationInfo;
      } catch {
        return false;
      }
      const passkeyId = await db.transaction(async (tx) => {
        const stored = await devices.addPending(
          tx,
          { accountId, sessionId },
          {
            credentialId: registered.credential.id,
            publicKey: Buffer.from(registered.credential.publicKey).toString('base64'),
            counter: registered.credential.counter,
            deviceType: registered.credentialDeviceType,
            backedUp: registered.credentialBackedUp,
            transports: response.response.transports ?? [],
            aaguid: registered.aaguid,
            prfEnabled: response.clientExtensionResults.prf?.enabled === true,
          },
        );
        if (stored === undefined) return undefined;
        await audit.record({
          code: 'passkey_added',
          subjectAccountId: accountId,
          actorAccountId: accountId,
          details: { passkeyId: stored },
        });
        return stored;
      });
      if (passkeyId === undefined) return false;
      await notify(accountId, 'passkey_added');
      return true;
    },

    // Every check compares the wait with the time, so a failed record never changes an answer.
    pendingUntil: async (accountId) => {
      try {
        await activateDue(accountId);
      } catch (error) {
        logger.error({
          errorName: `PasskeyActivation:${error instanceof Error ? error.name : 'NonErrorThrown'}`,
        });
      }
      return devices.pendingUntil(db, accountId);
    },
  };
}
