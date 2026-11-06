import { withIdentity, type Database } from '@arca/db';
import { sql, type SQL } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';
import { accounts } from '../auth/auth.js';
import { sweepExpiredInvites } from '../auth/invites.js';
import { markForRetentionErasure } from './deletion.js';
import { qualified } from './erasure.js';
import { forEachAccount } from './each-account.js';
import type { Notifier } from '../notification/notifier.js';
import type { DocumentObjects } from '../vault/documents.js';

/** The periods of RETENTION.md that the daily jobs count (spec 0004, R10). */
export const inactivityYears = 3;
export const inactivityNoticeDays = 60;
export const unconfirmedDays = 30;

/** A rule of the daily cleanup: the rows of `table` that `expired` matches at `now` go. */
export interface ExpiryRule {
  /** The RETENTION.md row it enforces, as that row's data cell begins. */
  readonly row: string;
  readonly table: string;
  readonly expired: (now: Date) => SQL;
}

/** A rule on a table under row-level security, run per account under its identity. */
export interface OwnedExpiryRule extends ExpiryRule {
  readonly owner: string;
}

const atOrBefore = (column: string, now: Date) => sql`${sql.identifier(column)} <= ${now}`;

export const expiryRules: readonly ExpiryRule[] = [
  { row: 'Sessions', table: 'auth.session', expired: (now) => atOrBefore('expires_at', now) },
  {
    row: 'Step-up challenges',
    table: 'auth.step_up_challenge',
    expired: (now) => atOrBefore('expires_at', now),
  },
  {
    row: 'Recovery links',
    table: 'auth.recovery_link',
    expired: (now) => atOrBefore('expires_at', now),
  },
  // An ended lock already reset its count; a count still under way stays.
  {
    row: 'Recovery lockouts',
    table: 'auth.recovery_lock',
    expired: (now) => sql`${atOrBefore('locked_until', now)} AND "failures" = 0`,
  },
  {
    row: 'Owner-enrollment registration contexts',
    table: 'auth.registration_context',
    expired: (now) => atOrBefore('expires_at', now),
  },
  {
    row: 'Non-production email outbox',
    table: 'auth.outbox',
    expired: (now) => atOrBefore('expires_at', now),
  },
];

/** Notification messages expire with their deliveries; rule reports a year after they were made. */
export const notificationDays = 90;
export const ruleReportDays = 365;

export const ownedExpiryRules: readonly OwnedExpiryRule[] = [
  {
    row: 'Notification messages and their deliveries',
    table: 'notification.message',
    owner: 'account_id',
    expired: (now) => atOrBefore('created_at', daysFrom(now, -notificationDays)),
  },
  {
    row: 'Rule reports',
    table: 'cases.rule_report',
    owner: 'reporter_account_id',
    expired: (now) => atOrBefore('created_at', daysFrom(now, -ruleReportDays)),
  },
];

/** The RETENTION.md rows the daily jobs enforce, for the docs test. */
export const enforcedRows = [
  ...expiryRules.map(({ row }) => row),
  ...ownedExpiryRules.map(({ row }) => row),
  'Pending document uploads',
  'Deleted and replaced document ciphertext',
  'Invites',
  'Unconfirmed invited accounts',
  'Case data and account data',
];

export function yearsBefore(now: Date, years: number): Date {
  const date = new Date(now);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date;
}

export const daysFrom = (now: Date, days: number) => new Date(now.getTime() + days * 86_400_000);

/** The steps of `enforceRetention` (spec 0004, R10); each takes the time it counts from. */
export interface Retention {
  /** The expired rows of the auth tables, on app_auth, and expired invites with their events. */
  sweepExpiredRows(now: Date): Promise<void>;
  /** Each account's expired rows in the tables under row-level security, as app_jobs. */
  expireOwnedRows(now: Date): Promise<void>;
  /** Each account's document uploads left unconfirmed for 24 hours, objects first. */
  expirePendingDocuments(now: Date): Promise<void>;
  /** Warns each account 3 years without a sign-in and marks it for erasure 60 days later. */
  warnInactiveAccounts(now: Date): Promise<void>;
  /** Marks invited accounts still unconfirmed after 30 days for erasure now. */
  markUnconfirmedAccounts(now: Date): Promise<void>;
}

export interface RetentionDependencies {
  /** The app_auth pool. */
  readonly authDb: Database;
  /** The app_jobs pool, whose erase policies hold only under the account's identity. */
  readonly jobsDb: Database;
  readonly audit: AuditLog;
  readonly notifier: Notifier;
  /** On the app_jobs pool, with the environment's object store. */
  readonly documents: Pick<DocumentObjects, 'expirePending'>;
  readonly ownedRules?: readonly OwnedExpiryRule[];
}

export function createRetention({
  authDb,
  jobsDb,
  audit,
  notifier,
  documents,
  ownedRules = ownedExpiryRules,
}: RetentionDependencies): Retention {
  return {
    sweepExpiredRows: (now) =>
      authDb.transaction(async (tx) => {
        for (const { table, expired } of expiryRules) {
          await tx.execute(sql`DELETE FROM ${qualified(table)} WHERE ${expired(now)}`);
        }
        await sweepExpiredInvites(tx, audit, now);
      }),

    async expireOwnedRows(now) {
      if (ownedRules.length === 0) return;
      await forEachAccount(await accounts.ids(authDb), (accountId) =>
        withIdentity(jobsDb, { accountId }, async (tx) => {
          for (const { table, owner, expired } of ownedRules) {
            await tx.execute(
              sql`DELETE FROM ${qualified(table)}
                   WHERE ${sql.identifier(owner)} = ${accountId} AND ${expired(now)}`,
            );
          }
        }),
      );
    },

    async expirePendingDocuments(now) {
      await forEachAccount(await accounts.ids(authDb), async (accountId) => {
        await documents.expirePending(accountId, now);
      });
    },

    async warnInactiveAccounts(now) {
      const cutoff = yearsBefore(now, inactivityYears);
      const dueAt = daysFrom(now, inactivityNoticeDays);
      await forEachAccount(await accounts.inactiveSince(authDb, cutoff), (accountId) =>
        authDb.transaction((tx) =>
          markForRetentionErasure(tx, audit, {
            accountId,
            reason: 'inactivity',
            dueAt,
            cutoff,
            actorAccountId: null,
            // Delivered inside the transaction: an account is never marked without its warning.
            announce: () => notifier.notify(accountId, { kind: 'inactivity_warning', dueAt }),
          }),
        ),
      );
    },

    async markUnconfirmedAccounts(now) {
      const cutoff = daysFrom(now, -unconfirmedDays);
      await forEachAccount(await accounts.unconfirmedSince(authDb, cutoff), (accountId) =>
        authDb.transaction((tx) =>
          markForRetentionErasure(tx, audit, {
            accountId,
            reason: 'invite_unconfirmed',
            dueAt: 'now',
            cutoff,
            actorAccountId: null,
          }),
        ),
      );
    },
  };
}
