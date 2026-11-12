import { withIdentity, type Database } from '@arca/db';
import {
  registry as fullRegistry,
  ownerColumns,
  type Registry,
  type RegistryEntry,
} from '@arca/db/registry';
import { sql, type SQL } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';
import { accounts, erasedAccounts } from '../auth/auth.js';
import { lockCase, memberCase } from '../case/view.js';
import type { Notices } from '../email/notices.js';
import type { DocumentObjects } from '../vault/documents.js';
import type { CorrectionContents } from '../knowledge/correction-contents.js';

/**
 * The steps of `eraseAccount` (spec 0004, R9), in their order. Each is idempotent, takes the
 * account ID from a server-side scan, and reads nothing it does not erase or report.
 */
export interface Erasure {
  /** Whether the erasure may go on: the deletion is due, or the account is already gone. */
  erasable(accountId: string): Promise<boolean>;
  /**
   * Deletes the account's stored objects, documents and correction request files, while the rows
   * that name them remain.
   */
  eraseStoredObjects(accountId: string): Promise<void>;
  /** Erases the account's rows in every app_jobs entry, under its identity. */
  eraseOwnedEntries(accountId: string): Promise<void>;
  /** Reads the address and sends the completion notice in one step; nothing once it is gone. */
  sendCompletionNotice(accountId: string): Promise<void>;
  /**
   * Erases the auth rows, then the expired rows of the unowned tables kept until expiry, and notes
   * the account until its event is written, so the daily scan still finds it.
   */
  eraseAuthRows(accountId: string): Promise<void>;
  /** Last, once per noted account; the note goes with it. */
  recordErased(accountId: string): Promise<void>;
}

export interface ErasureDependencies {
  /** The app_auth pool. */
  readonly authDb: Database;
  /** The app_jobs pool, whose erase policies hold only under the account's identity. */
  readonly jobsDb: Database;
  readonly audit: AuditLog;
  readonly notices: Notices;
  /** On the app_jobs pool, with the environment's object store. */
  readonly documents: Pick<DocumentObjects, 'eraseObjects'>;
  readonly corrections: Pick<CorrectionContents, 'eraseObjects'>;
  readonly registry?: Registry;
  readonly clock?: () => Date;
}

/** A registry table name, `schema.table`, as quoted SQL. */
export function qualified(table: string): SQL {
  const [schema = '', name = ''] = table.split('.');
  return sql`${sql.identifier(schema)}.${sql.identifier(name)}`;
}

/** Entries erased by their own owner columns; a parent's children leave by its cascade. */
const ownedByColumn = (entry: RegistryEntry, pool: 'app_auth' | 'app_jobs') =>
  entry.strategy === 'delete' && entry.pool === pool && ownerColumns(entry.owner).length > 0;

/** The entry's rows that name the account in any of its owner columns. */
export function namesAccount(entry: RegistryEntry, accountId: string, alias?: string): SQL {
  const matches = ownerColumns(entry.owner).map((name) =>
    alias === undefined
      ? sql`${sql.identifier(name)} = ${accountId}`
      : sql`${sql.identifier(alias)}.${sql.identifier(name)} = ${accountId}`,
  );
  return sql.join(matches, sql` OR `);
}

function eraseOwned(entry: RegistryEntry, accountId: string): SQL {
  return sql`DELETE FROM ${qualified(entry.table)} WHERE ${namesAccount(entry, accountId)}`;
}

export function createErasure({
  authDb,
  jobsDb,
  audit,
  notices,
  documents,
  corrections,
  registry = fullRegistry,
  clock = () => new Date(),
}: ErasureDependencies): Erasure {
  const jobsEntries = registry.entries.filter((entry) => ownedByColumn(entry, 'app_jobs'));
  // The account's own row goes last, after every row that points at it.
  const authEntries = registry.entries
    .filter((entry) => ownedByColumn(entry, 'app_auth'))
    .reverse();
  const expiring = registry.unowned.flatMap((table) =>
    table.personalData === 'until-expiry' ? [table] : [],
  );

  return {
    erasable: (accountId) => accounts.erasable(authDb, accountId),

    eraseStoredObjects: async (accountId) => {
      await documents.eraseObjects(accountId);
      await corrections.eraseObjects(accountId);
    },

    // The member's own row is the registry's first case entry, so the account leaves its case
    // first and the cascade takes the people it keeps, as leaving does (spec 0007, R9).
    eraseOwnedEntries: (accountId) =>
      withIdentity(jobsDb, { accountId }, async (tx) => {
        const caseId = await memberCase(tx, accountId);
        if (caseId !== undefined) await lockCase(tx, caseId);
        for (const entry of jobsEntries) await tx.execute(eraseOwned(entry, accountId));
      }),

    async sendCompletionNotice(accountId) {
      const to = await accounts.emailOf(authDb, accountId);
      if (to !== undefined) await notices.send({ kind: 'account_erased', to, at: clock() });
    },

    eraseAuthRows: (accountId) =>
      authDb.transaction(async (tx) => {
        await erasedAccounts.note(tx, accountId);
        for (const entry of authEntries) await tx.execute(eraseOwned(entry, accountId));
        for (const { table, expiresAt } of expiring) {
          await tx.execute(
            sql`DELETE FROM ${qualified(table)} WHERE ${sql.identifier(expiresAt)} <= now()`,
          );
        }
      }),

    recordErased: (accountId) =>
      authDb.transaction(async (tx) => {
        if (!(await erasedAccounts.take(tx, accountId))) return;
        // Recorded before the commit, like every security event.
        await audit.record({
          code: 'account_erased',
          subjectAccountId: accountId,
          actorAccountId: null,
          details: {},
        });
      }),
  };
}

/** Runs every step in the workflow's order, in one call; the database tests use it. */
export async function eraseAccountNow(erasure: Erasure, accountId: string): Promise<boolean> {
  if (!(await erasure.erasable(accountId))) return false;
  await erasure.eraseStoredObjects(accountId);
  await erasure.eraseOwnedEntries(accountId);
  await erasure.sendCompletionNotice(accountId);
  await erasure.eraseAuthRows(accountId);
  await erasure.recordErased(accountId);
  return true;
}
