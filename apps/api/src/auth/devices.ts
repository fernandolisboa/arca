import {
  DeviceDescription,
  type DevicePasskey,
  type DevicesResponse,
} from '@arca/api-contract/routes';
import type { Database } from '@arca/db';
import { stepUp } from '@arca/db/step-up-schema';
import { and, eq, isNull } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';
import type { NoticeKind, Notices } from '../email/notices.js';
import type { Logger } from '../logger.js';
import { accounts, devices } from './auth.js';
import { absoluteSessionLifetimeMs, type SignedIn } from './service.js';

export type PasskeyRevocation = 'revoked' | 'not_found' | 'last_active';

/** The device list and its revocations (spec 0003, R4); each route checks its step-up first. */
export interface Devices {
  readonly list: (signedIn: SignedIn) => Promise<DevicesResponse>;
  /** False when the session is not the account's. */
  readonly revokeSession: (signedIn: SignedIn, sessionId: string) => Promise<boolean>;
  readonly revokePasskey: (signedIn: SignedIn, passkeyId: string) => Promise<PasskeyRevocation>;
  readonly revokeOtherSessions: (signedIn: SignedIn) => Promise<void>;
}

export interface DeviceSettings {
  /** A database on the app_auth pool. */
  readonly db: Database;
  readonly audit: AuditLog;
  readonly notices: Notices;
  readonly logger: Logger;
  readonly clock?: () => Date;
}

export function createDevices({
  db,
  audit,
  notices,
  logger,
  clock = () => new Date(),
}: DeviceSettings): Devices {
  /** A notice that fails to send never undoes the revocation; the failure is logged. */
  async function notify(
    accountId: string,
    kind: Extract<NoticeKind, 'passkey_revoked' | 'sessions_revoked'>,
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

  const sessionRevoked = (accountId: string, sessionId: string) =>
    audit.record({
      code: 'session_revoked',
      subjectAccountId: accountId,
      actorAccountId: accountId,
      details: { sessionId },
    });

  return {
    list: async ({ accountId, sessionId }) => {
      const since = new Date(clock().getTime() - absoluteSessionLifetimeMs);
      const { passkeys, sessions } = await devices.of(db, accountId, since);
      return {
        passkeys: passkeys.map(({ id, credentialId, createdAt }): DevicePasskey => {
          const signed = sessions
            .filter((session) => session.credentialId === credentialId)
            .map((session) => ({
              id: session.id,
              // Parsed, so a stored value outside the enums fails loudly instead of reaching a client.
              device: DeviceDescription.parse({ browser: session.browser, os: session.os }),
              createdAt: session.createdAt.toISOString(),
              lastUsedAt: session.updatedAt.toISOString(),
              current: session.id === sessionId,
            }));
          return {
            id,
            createdAt: createdAt?.toISOString() ?? null,
            current: signed.some(({ current }) => current),
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
        // What it approved and nothing spent yet, an open vault_unlock window included, ends
        // with it, in whichever session it was verified (spec 0003, R5).
        await tx
          .delete(stepUp)
          .where(
            and(
              eq(stepUp.accountId, accountId),
              eq(stepUp.credentialId, revoked.credentialId),
              isNull(stepUp.consumedAt),
            ),
          );
        await audit.record({
          code: 'passkey_revoked',
          subjectAccountId: accountId,
          actorAccountId: accountId,
          details: { passkeyId },
        });
        return 'revoked' as const;
      });
      if (outcome === 'revoked') await notify(accountId, 'passkey_revoked');
      return outcome;
    },

    revokeOtherSessions: async ({ accountId, sessionId }) => {
      const ended = await db.transaction(async (tx) => {
        const ids = await devices.revokeOtherSessions(tx, accountId, sessionId);
        for (const id of ids) await sessionRevoked(accountId, id);
        return ids.length;
      });
      if (ended > 0) await notify(accountId, 'sessions_revoked');
    },
  };
}
