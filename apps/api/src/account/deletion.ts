import { deletionWaitDays } from '@arca/api-contract/routes';
import type { Database } from '@arca/db';
import type { Logger } from '@arca/telemetry';
import type { AuditLog } from '../audit/log.js';
import { accountNotice } from '../auth/account-notices.js';
import { accounts, devices } from '../auth/auth.js';
import type { Notices } from '../email/notices.js';

export interface AccountDeletion {
  /**
   * Ends every session and marks the account for erasure (spec 0004, R9); a second request keeps
   * the first due time. The due time, or undefined when the account is gone.
   */
  request(accountId: string): Promise<Date | undefined>;
  /** False when no deletion waits, or its time has come. */
  cancel(accountId: string): Promise<boolean>;
}

export interface AccountDeletionSettings {
  /** A database on the app_auth pool. */
  readonly db: Database;
  readonly audit: AuditLog;
  readonly notices: Notices;
  readonly logger: Logger;
  readonly clock?: () => Date;
}

export function createAccountDeletion({
  db,
  audit,
  notices,
  logger,
  clock,
}: AccountDeletionSettings): AccountDeletion {
  const notify = accountNotice<'deletion_requested' | 'deletion_cancelled'>({
    db,
    notices,
    logger,
    label: 'DeletionNotice',
    ...(clock === undefined ? {} : { clock }),
  });

  return {
    async request(accountId) {
      const outcome = await db.transaction(async (tx) => {
        if (!(await accounts.lock(tx, accountId))) return undefined;
        const first = (await accounts.deletionDueAt(tx, accountId)) === null;
        const dueAt = await accounts.requestDeletion(tx, accountId, deletionWaitDays);
        // Recorded before the commit, like every security event.
        for (const sessionId of await devices.revokeAllSessions(tx, accountId)) {
          await audit.record({
            code: 'session_revoked',
            subjectAccountId: accountId,
            actorAccountId: accountId,
            details: { sessionId },
          });
        }
        if (first) {
          await audit.record({
            code: 'deletion_requested',
            subjectAccountId: accountId,
            actorAccountId: accountId,
            details: { reason: 'owner_request' },
          });
        }
        return dueAt === undefined ? undefined : { dueAt, first };
      });
      if (outcome?.first === true) await notify(accountId, 'deletion_requested');
      return outcome?.dueAt;
    },

    async cancel(accountId) {
      const cancelled = await db.transaction(async (tx) => {
        if (!(await accounts.cancelDeletion(tx, accountId))) return false;
        await audit.record({
          code: 'deletion_cancelled',
          subjectAccountId: accountId,
          actorAccountId: accountId,
          details: { reason: 'owner_cancel' },
        });
        return true;
      });
      if (cancelled) await notify(accountId, 'deletion_cancelled');
      return cancelled;
    },
  };
}
