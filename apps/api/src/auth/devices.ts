import { randomBytes } from 'node:crypto';
import {
  DeviceDescription,
  type AddPasskeyOptionsResponse,
  type DevicePasskey,
  type DevicesResponse,
  type PasskeyAttestation,
} from '@arca/api-contract/routes';
import type { Database } from '@arca/db';
import { passkeyChallenge as challenge, recoveryCode } from '@arca/db/enrollment-schema';
import { and, eq, lte, sql } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';
import type { Notifier } from '../notification/notifier.js';
import type { Logger } from '@arca/telemetry';
import { accountNotice } from './account-notices.js';
import { accounts, devices } from './auth.js';
import { passkeyCreation } from './passkey-creation.js';
import { absoluteSessionLifetimeMs, type SignedIn } from './service.js';
import { forgetUnspent } from './step-up.js';

export type PasskeyRevocation = 'revoked' | 'not_found' | 'last_active' | 'recovery_pending';

/**
 * The device list, its revocations and adding a passkey (spec 0003, R4); each route that needs a
 * step-up spends it before calling these.
 */
export interface Devices {
  readonly list: (signedIn: SignedIn) => Promise<DevicesResponse>;
  /** False when the session is not the account's. */
  readonly revokeSession: (signedIn: SignedIn, sessionId: string) => Promise<boolean>;
  /**
   * Revokes an active passkey, or cancels a pending one. `beforeRevoke` runs first, once the
   * revocation is allowed, and a failure in it keeps the passkey (spec 0005, R2).
   */
  readonly revokePasskey: (
    signedIn: SignedIn,
    passkeyId: string,
    beforeRevoke: (credentialId: string) => Promise<void>,
  ) => Promise<PasskeyRevocation>;
  readonly revokeOtherSessions: (signedIn: SignedIn) => Promise<void>;
  readonly addOptions: (signedIn: SignedIn) => Promise<AddPasskeyOptionsResponse>;
  /** False for every refusal alike, so a caller learns nothing about why. */
  readonly add: (
    signedIn: SignedIn,
    challengeId: string,
    response: PasskeyAttestation,
  ) => Promise<boolean>;
  /**
   * What every session of the account shows (spec 0003, R4, R6), once the waits that are over
   * are recorded as activations: when the newest pending passkey becomes active, and whether a
   * recovery passkey is pending, which restricts every session. With a session, also whether it
   * outlived them, since a recovery passkey's activation ends the sessions it restricted.
   */
  readonly status: (accountId: string, sessionId?: string) => Promise<AccountStatus>;
}

export interface AccountStatus {
  readonly pendingUntil: Date | null;
  readonly recoveryPending: boolean;
  /** When the account is erased, while its deletion waits (spec 0004, R9). */
  readonly deletionDueAt: Date | null;
  /** The session asked about no longer exists, maybe ended by a recovery passkey's activation. */
  readonly sessionEnded: boolean;
}

export interface DeviceSettings {
  /** A database on the app_auth pool. */
  readonly db: Database;
  readonly audit: AuditLog;
  readonly notifier: Notifier;
  readonly logger: Logger;
  /** The environment's own origin; its host is the relying-party ID (spec 0003, R9). */
  readonly origin: string;
  readonly clock?: () => Date;
}

export function createDevices({
  db,
  audit,
  notifier,
  logger,
  origin,
  clock = () => new Date(),
}: DeviceSettings): Devices {
  const creation = passkeyCreation({ db, origin });

  const notify = accountNotice<
    'passkey_added' | 'passkey_revoked' | 'pending_passkey_cancelled' | 'sessions_revoked'
  >({ notifier, logger, label: 'DeviceNotice' });

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
      const activated = await devices.activateDue(tx, accountId);
      for (const passkeyId of activated) {
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
        passkeys: passkeys.map(
          ({ id, credentialId, createdAt, recovery, pendingUntil }): DevicePasskey => {
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
              recovery,
              sessions: signed,
            };
          },
        ),
      };
    },

    // Recorded before the commit, like every security event: a failed write keeps the session.
    revokeSession: ({ accountId }, sessionId) =>
      db.transaction(async (tx) => {
        if (!(await devices.revokeSession(tx, accountId, sessionId))) return false;
        await sessionRevoked(accountId, sessionId);
        return true;
      }),

    revokePasskey: async ({ accountId }, passkeyId, beforeRevoke) => {
      const outcome = await db.transaction(async (tx) => {
        const revoked = await devices.revokePasskey(tx, accountId, passkeyId, beforeRevoke);
        if (typeof revoked === 'string') return revoked;
        await forgetUnspent(tx, accountId, revoked.credentialId);
        await audit.record({
          code: 'passkey_revoked',
          subjectAccountId: accountId,
          actorAccountId: accountId,
          details: { passkeyId },
        });
        if (revoked.recovery) {
          // The code that recovery issued goes too, which closes recovery until a new kit (R6).
          await tx.delete(recoveryCode).where(eq(recoveryCode.accountId, accountId));
          await audit.record({
            code: 'recovery_cancelled',
            subjectAccountId: accountId,
            actorAccountId: accountId,
            details: {},
          });
        }
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
      const value = randomBytes(32);
      const [issued] = await db
        .insert(challenge)
        .values({ accountId, sessionId, challenge: value })
        .returning({ id: challenge.id });
      if (issued === undefined) throw new Error('the challenge was not stored');
      return { challengeId: issued.id, options: await creation.options(accountId, value) };
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
      const added = await creation.verify(response, issued.challenge);
      if (added === null) return false;
      const passkeyId = await db.transaction(async (tx) => {
        const stored = await devices.addPending(tx, { accountId, sessionId }, added);
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

    // A failed record changes no answer: an added passkey's checks compare its wait with the
    // time, and a recovery passkey keeps every session restricted until its activation is
    // recorded with the revocation of those sessions.
    status: async (accountId, sessionId) => {
      try {
        await activateDue(accountId);
      } catch (error) {
        logger.error({
          errorName: `PasskeyActivation:${error instanceof Error ? error.name : 'NonErrorThrown'}`,
        });
      }
      return {
        pendingUntil: await devices.pendingUntil(db, accountId),
        recoveryPending: await devices.recoveryPending(db, accountId),
        deletionDueAt: await accounts.deletionDueAt(db, accountId),
        // Read after the activation, whichever request ran it, so no ended session slips by.
        sessionEnded: sessionId !== undefined && !(await devices.sessionExists(db, sessionId)),
      };
    },
  };
}
