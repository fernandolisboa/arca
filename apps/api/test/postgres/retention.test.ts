import { randomBytes, randomUUID } from 'node:crypto';
import { withIdentity } from '@arca/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createRetention,
  daysFrom,
  expiryRules,
  yearsBefore,
  type OwnedExpiryRule,
  type Retention,
} from '../../src/account/retention.js';
import { auditLog } from '../../src/audit/log.js';
import { accounts } from '../../src/auth/auth.js';
import type { Notice, Notices } from '../../src/email/notices.js';
import { createDelivery, deliverNow } from '../../src/notification/delivery.js';
import { createNotifier } from '../../src/notification/notifier.js';
import { createDocuments } from '../../src/vault/documents.js';
import { memoryObjectStorage } from '../../src/vault/object-storage.js';
import { authTestDatabase, silentLogger, type AuthTestDatabase } from './auth-database.js';
import { seeded } from './every-table.js';

// The daily retention rules on the real migrations, through the runtime roles' pools (spec 0004,
// R10). Synthetic data only. Each test counts from its own `now`, an hour ahead of the database,
// so every row it places on either side of a boundary is its own.
let testDatabase: AuthTestDatabase;
let sent: Notice[];
let failing: boolean;

const notices: Notices = {
  send: (notice) => {
    if (failing) return Promise.reject(new Error('unavailable'));
    sent.push(notice);
    return Promise.resolve();
  },
};

const retentionWith = (ownedRules?: readonly OwnedExpiryRule[]): Retention =>
  createRetention({
    authDb: testDatabase.authDb,
    jobsDb: testDatabase.jobsDb,
    audit: auditLog(testDatabase.auditDb),
    documents: createDocuments({
      db: testDatabase.jobsDb,
      storage: memoryObjectStorage(),
      audit: auditLog(testDatabase.auditDb),
    }),
    // As the daily job runs it: the warning delivered in the step, before the marking commits.
    notifier: createNotifier({
      db: testDatabase.jobsDb,
      startDelivery: (accountId, messageId) =>
        deliverNow(
          createDelivery({
            jobsDb: testDatabase.jobsDb,
            authDb: testDatabase.authDb,
            notices,
            logger: silentLogger,
          }),
          accountId,
          messageId,
          silentLogger,
        ),
    }),
    ...(ownedRules === undefined ? {} : { ownedRules }),
  });

beforeAll(async () => {
  testDatabase = await authTestDatabase();
});

beforeEach(() => {
  sent = [];
  failing = false;
});

afterAll(async () => {
  await testDatabase.drop();
});

const admin = async <Row extends object>(statement: string, values: unknown[] = []) =>
  (await testDatabase.asAdmin((client) => client.query<Row>(statement, values))).rows;

const later = () => new Date(Date.now() + 3_600_000);
const second = 1000;
const before = (now: Date) => new Date(now.getTime() - second);
const after = (now: Date) => new Date(now.getTime() + second);

async function events(accountId: string, code: string) {
  return admin<{ actor: string | null; details: object }>(
    `SELECT actor_account_id AS actor, details FROM audit.event
      WHERE subject_account_id = $1 AND code = $2 ORDER BY time`,
    [accountId, code],
  );
}

/** The warnings produced for these accounts, as app_jobs recorded them. */
const warningsTo = (owners: readonly { accountId: string }[]) =>
  admin<{ account: string; details: object; delivered: boolean }>(
    `SELECT m.account_id AS account, m.details,
            EXISTS (SELECT FROM notification.delivery d WHERE d.message_id = m.id) AS delivered
       FROM notification.message m
      WHERE m.account_id = ANY ($1) AND m.code = 'inactivity_warning'`,
    [owners.map(({ accountId }) => accountId)],
  );

async function deletionOf(accountId: string) {
  const [row] = await admin<{ due: Date | null; reason: string | null }>(
    'SELECT deletion_due_at AS due, deletion_reason AS reason FROM auth.user WHERE id = $1',
    [accountId],
  );
  return row;
}

describe('the daily cleanup (spec 0004, R10)', () => {
  it('deletes the rows expired at its time and keeps the rest, in every auth rule', async () => {
    const now = later();
    const expired = await seeded(testDatabase);
    const live = await seeded(testDatabase);
    const counting = await seeded(testDatabase);
    const ended = await seeded(testDatabase);
    const place = async (accountId: string, at: Date, failures = 0) => {
      await admin('UPDATE auth.step_up_challenge SET expires_at = $2 WHERE account_id = $1', [
        accountId,
        at,
      ]);
      await admin('UPDATE auth.recovery_link SET expires_at = $2 WHERE account_id = $1', [
        accountId,
        at,
      ]);
      await admin(
        'UPDATE auth.recovery_lock SET locked_until = $2, failures = $3 WHERE account_id = $1',
        [accountId, at, failures],
      );
      await admin('UPDATE auth.invite SET expires_at = $2 WHERE inviter_id = $1', [accountId, at]);
    };
    await place(expired.accountId, before(now));
    await place(live.accountId, after(now));
    await place(counting.accountId, before(now), 2);
    await admin('UPDATE auth.session SET expires_at = $2 WHERE user_id = $1', [
      ended.accountId,
      before(now),
    ]);
    await admin('UPDATE auth.session SET expires_at = $2 WHERE user_id = $1', [
      live.accountId,
      after(now),
    ]);
    const tag = randomBytes(6).toString('hex');
    for (const [name, at] of [
      ['expired', before(now)],
      ['live', after(now)],
    ] as const) {
      await admin(
        `INSERT INTO auth.registration_context (token_hash, kind, email, expires_at)
         VALUES ($1, 'owner', $2, $3)`,
        [randomBytes(32), `${name}-${tag}@example.com`, at],
      );
      await admin(
        `INSERT INTO auth.outbox (recipient, subject, body, expires_at) VALUES ($1, 's', 'b', $2)`,
        [`${name}-${tag}@example.com`, at],
      );
    }

    await retentionWith().sweepExpiredRows(now);

    const count = async (table: string, column: string, accountId: string) =>
      (
        await admin<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [
          accountId,
        ])
      )[0]?.n;
    for (const [table, column] of [
      ['auth.step_up_challenge', 'account_id'],
      ['auth.recovery_link', 'account_id'],
      ['auth.recovery_lock', 'account_id'],
      ['auth.invite', 'inviter_id'],
    ] as const) {
      expect(await count(table, column, expired.accountId), table).toBe(0);
      expect(await count(table, column, live.accountId), table).toBe(1);
    }
    // A lock whose count is still under way stays.
    expect(await count('auth.recovery_lock', 'account_id', counting.accountId)).toBe(1);
    expect(await count('auth.session', 'user_id', ended.accountId)).toBe(0);
    expect(await count('auth.session', 'user_id', live.accountId)).toBe(1);
    for (const table of ['auth.registration_context', 'auth.outbox']) {
      const column = table === 'auth.outbox' ? 'recipient' : 'email';
      const left = await admin<{ address: string }>(
        `SELECT ${column} AS address FROM ${table} WHERE ${column} LIKE $1`,
        [`%-${tag}@example.com`],
      );
      expect(left.map(({ address }) => address)).toEqual([`live-${tag}@example.com`]);
    }
    expect(await events(expired.accountId, 'invite_expired')).toHaveLength(1);
    expect(await events(live.accountId, 'invite_expired')).toEqual([]);
  });

  it('has a rule for each auth table it names, and only real tables', async () => {
    for (const { table } of expiryRules) {
      const [found] = await admin<{ exists: boolean }>(
        'SELECT to_regclass($1) IS NOT NULL AS exists',
        [table],
      );
      expect(found?.exists, table).toBe(true);
    }
  });
});

describe('rules on tables under row-level security (spec 0004, R10)', () => {
  const identity = `account_id = nullif(current_setting('app.account_id', true), '')::uuid`;
  const probe: OwnedExpiryRule = {
    row: 'Probe',
    table: 'public.retention_probe',
    owner: 'account_id',
    expired: (now) => sql`${sql.identifier('expires_at')} <= ${now}`,
  };

  beforeAll(async () => {
    await testDatabase.asAdmin((client) =>
      client.query(`
        CREATE TABLE public.retention_probe (account_id uuid NOT NULL, expires_at timestamptz NOT NULL);
        ALTER TABLE public.retention_probe ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.retention_probe FORCE ROW LEVEL SECURITY;
        CREATE POLICY probe_erase ON public.retention_probe FOR DELETE TO app_jobs USING (${identity});
        CREATE POLICY probe_read ON public.retention_probe FOR SELECT TO app_jobs USING (${identity});
        GRANT SELECT, DELETE ON public.retention_probe TO app_jobs;`),
    );
  });

  const probeRows = (accountId: string) =>
    admin<{ expires_at: Date }>(
      'SELECT expires_at FROM public.retention_probe WHERE account_id = $1',
      [accountId],
    );

  it("expires each account's rows under its own identity, and no one else's", async () => {
    const now = later();
    const a = await seeded(testDatabase);
    const b = await seeded(testDatabase);
    // Rows of an ID with no account: no run has its identity, so they stay though expired.
    const orphan = randomUUID();
    for (const accountId of [a.accountId, b.accountId, orphan]) {
      await admin('INSERT INTO public.retention_probe VALUES ($1, $2), ($1, $3)', [
        accountId,
        before(now),
        after(now),
      ]);
    }
    await retentionWith([probe]).expireOwnedRows(now);
    for (const { accountId } of [a, b]) {
      expect(await probeRows(accountId)).toEqual([{ expires_at: after(now) }]);
    }
    expect(await probeRows(orphan)).toHaveLength(2);
  });

  it("leaves another account's expired rows under one account's identity", async () => {
    const now = later();
    const a = await seeded(testDatabase);
    const b = await seeded(testDatabase);
    for (const { accountId } of [a, b]) {
      await admin('INSERT INTO public.retention_probe VALUES ($1, $2)', [accountId, before(now)]);
    }
    await withIdentity(testDatabase.jobsDb, { accountId: a.accountId }, (tx) =>
      tx.execute(sql`DELETE FROM public.retention_probe WHERE expires_at <= ${now}`),
    );
    expect(await probeRows(a.accountId)).toEqual([]);
    expect(await probeRows(b.accountId)).toHaveLength(1);
  });
});

describe('pending document uploads (spec 0005, R4)', () => {
  it("deletes each account's uploads unconfirmed for 24 hours, under its own identity", async () => {
    const now = later();
    const a = await seeded(testDatabase);
    const b = await seeded(testDatabase);
    const pending = (accountId: string) =>
      admin<{ id: string }>(
        'SELECT id FROM vault.document WHERE owner_id = $1 AND confirmed_at IS NULL',
        [accountId],
      );
    await admin('UPDATE vault.document SET created_at = $2 WHERE owner_id = ANY ($1)', [
      [a.accountId, b.accountId],
      new Date(now.getTime() - 24 * 3_600_000),
    ]);
    const fresh = randomUUID();
    await admin(
      `INSERT INTO vault.document (id, owner_id, type_key, size, sha256, object_key, label)
       VALUES ($1, $2, 'passport', 1, $3, $4, decode('01', 'hex'))`,
      [fresh, a.accountId, randomBytes(32), `documents/${randomUUID()}`],
    );
    expect(await pending(b.accountId)).not.toEqual([]);
    await retentionWith().expirePendingDocuments(now);
    expect(await pending(a.accountId)).toEqual([{ id: fresh }]);
    expect(await pending(b.accountId)).toEqual([]);
  });
});

describe('the inactivity job (spec 0004, R10)', () => {
  it('warns and marks each account 3 years without a sign-in, counting from creation if none', async () => {
    const now = later();
    const cutoff = yearsBefore(now, 3);
    const atCutoff = await seeded(testDatabase);
    const neverSignedIn = await seeded(testDatabase);
    const recent = await seeded(testDatabase);
    await admin('UPDATE auth.user SET last_sign_in_at = $2 WHERE id = $1', [
      atCutoff.accountId,
      cutoff,
    ]);
    await admin('UPDATE auth.user SET created_at = $2, last_sign_in_at = NULL WHERE id = $1', [
      neverSignedIn.accountId,
      before(cutoff),
    ]);
    await admin('UPDATE auth.user SET created_at = $2, last_sign_in_at = $3 WHERE id = $1', [
      recent.accountId,
      before(cutoff),
      after(cutoff),
    ]);

    await retentionWith().warnInactiveAccounts(now);

    const dueAt = daysFrom(now, 60);
    for (const { accountId } of [atCutoff, neverSignedIn]) {
      expect(await deletionOf(accountId)).toEqual({ due: dueAt, reason: 'inactivity' });
      expect(await events(accountId, 'deletion_requested')).toEqual([
        { actor: null, details: { reason: 'inactivity' } },
      ]);
    }
    expect(await deletionOf(recent.accountId)).toEqual({ due: null, reason: null });
    const warned = await warningsTo([atCutoff, neverSignedIn, recent]);
    expect(warned.map(({ account }) => account).sort()).toEqual(
      [atCutoff.accountId, neverSignedIn.accountId].sort(),
    );
    for (const message of warned) {
      expect(message).toMatchObject({ details: { dueAt: dueAt.toISOString() }, delivered: true });
    }
    const emailed = sent.filter(({ to }) =>
      [atCutoff.email, neverSignedIn.email, recent.email].includes(to),
    );
    expect(emailed.map(({ to }) => to).sort()).toEqual(
      [atCutoff.email, neverSignedIn.email].sort(),
    );
    expect(emailed.every((notice) => notice.kind === 'inactivity_warning')).toBe(true);
    expect(emailed[0]).toMatchObject({ dueAt });

    await retentionWith().warnInactiveAccounts(now);
    expect(await warningsTo([atCutoff])).toHaveLength(1);
    expect(await events(atCutoff.accountId, 'deletion_requested')).toHaveLength(1);
  });

  it('marks nothing and records nothing when the warning cannot be sent', async () => {
    const now = later();
    const a = await seeded(testDatabase);
    await admin('UPDATE auth.user SET last_sign_in_at = $2 WHERE id = $1', [
      a.accountId,
      yearsBefore(now, 4),
    ]);
    failing = true;
    await expect(retentionWith().warnInactiveAccounts(now)).rejects.toThrow();
    expect(await deletionOf(a.accountId)).toEqual({ due: null, reason: null });
    expect(await events(a.accountId, 'deletion_requested')).toEqual([]);
  });
});

describe('unconfirmed invited accounts (spec 0004, R10)', () => {
  it('marks each one 30 days old for erasure now, ending its sessions, and records it first', async () => {
    const now = later();
    const cutoff = daysFrom(now, -30);
    const old = await seeded(testDatabase);
    const young = await seeded(testDatabase);
    const confirmed = await seeded(testDatabase);
    await admin('UPDATE auth.user SET created_at = $2, confirmed_at = NULL WHERE id = $1', [
      old.accountId,
      cutoff,
    ]);
    await admin('UPDATE auth.user SET created_at = $2, confirmed_at = NULL WHERE id = $1', [
      young.accountId,
      after(cutoff),
    ]);
    await admin('UPDATE auth.user SET created_at = $2, confirmed_at = $2 WHERE id = $1', [
      confirmed.accountId,
      before(cutoff),
    ]);

    await retentionWith().markUnconfirmedAccounts(now);

    // Due at once, by the database's own time, which the erasure's due check reads.
    const marked = await deletionOf(old.accountId);
    expect(marked?.reason).toBe('invite_unconfirmed');
    expect(marked?.due?.getTime()).toBeLessThanOrEqual(Date.now());
    // Too late for the inviter to confirm it.
    expect(await accounts.confirm(testDatabase.authDb, old.accountId)).toBe(false);
    expect(await events(old.accountId, 'deletion_requested')).toEqual([
      { actor: null, details: { reason: 'invite_unconfirmed' } },
    ]);
    expect(await events(old.accountId, 'session_revoked')).toHaveLength(1);
    const [sessions] = await admin<{ n: number }>(
      'SELECT count(*)::int AS n FROM auth.session WHERE user_id = $1',
      [old.accountId],
    );
    expect(sessions).toEqual({ n: 0 });
    for (const { accountId } of [young, confirmed]) {
      expect(await deletionOf(accountId)).toEqual({ due: null, reason: null });
    }
  });
});
