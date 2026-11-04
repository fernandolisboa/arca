import { randomUUID } from 'node:crypto';
import { registry, type Registry } from '@arca/db/registry';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAccountDeletion, type AccountDeletion } from '../../src/account/deletion.js';
import { createErasure, eraseAccountNow, type Erasure } from '../../src/account/erasure.js';
import { accounts } from '../../src/auth/auth.js';
import type { Tombstones } from '../../src/account/tombstones.js';
import { auditLog } from '../../src/audit/log.js';
import type { Notice, Notices } from '../../src/email/notices.js';
import { authTestDatabase, silentLogger, type AuthTestDatabase } from './auth-database.js';
import { ownedCountQuery, ownedCounts, seeded } from './every-table.js';

// Account deletion and erasure on the real migrations, through the runtime roles' pools (spec
// 0004, R9). Synthetic data only.
let testDatabase: AuthTestDatabase;
let sent: Notice[];
let tombstones: string[];
let deletion: AccountDeletion;

const notices: Notices = {
  send: (notice) => {
    sent.push(notice);
    return Promise.resolve();
  },
};
const tombstoneLog: Tombstones = {
  write: (accountId) => {
    tombstones.push(accountId);
    return Promise.resolve();
  },
};

const erasureWith = (
  checked: Registry = registry,
  tombstones: Tombstones = tombstoneLog,
): Erasure =>
  createErasure({
    authDb: testDatabase.authDb,
    jobsDb: testDatabase.jobsDb,
    audit: auditLog(testDatabase.auditDb),
    notices,
    tombstones,
    registry: checked,
  });

const due = () => accounts.dueForErasure(testDatabase.authDb);

beforeAll(async () => {
  testDatabase = await authTestDatabase();
  deletion = createAccountDeletion({
    db: testDatabase.authDb,
    audit: auditLog(testDatabase.auditDb),
    notices,
    logger: silentLogger,
  });
});

beforeEach(() => {
  sent = [];
  tombstones = [];
});

afterAll(async () => {
  await testDatabase.drop();
});

const admin = (statement: string, values: unknown[] = []) =>
  testDatabase.asAdmin((client) => client.query(statement, values));

async function events(accountId: string) {
  const result = await admin(
    `SELECT code, actor_account_id AS actor, details FROM audit.event
      WHERE subject_account_id = $1 ORDER BY time, code`,
    [accountId],
  );
  return result.rows as { code: string; actor: string | null; details: object }[];
}

const dueAtOf = async (accountId: string) =>
  (await admin('SELECT deletion_due_at AS due FROM auth.user WHERE id = $1', [accountId]))
    .rows[0] as { due: Date | null } | undefined;

const makeDue = (accountId: string) =>
  admin(
    `UPDATE auth.user SET deletion_due_at = now() - interval '1 minute',
            deletion_reason = coalesce(deletion_reason, 'owner_request') WHERE id = $1`,
    [accountId],
  );

/**
 * The account's rows per registry table, each counted by a role that sees them honestly: app_auth
 * for the auth schema, which has no row-level security, and app_backup for the rest, whose read
 * policy is the one counter that row-level security does not hide rows from.
 */
async function remaining(accountId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const entry of registry.entries) {
    const query = ownedCountQuery(entry);
    if (entry.table.startsWith('auth.')) {
      const result = await testDatabase.authDb.execute<{ n: number }>(
        sql.raw(query.replace('$1', `'${accountId}'`)),
      );
      counts[entry.table] = result.rows[0]?.n ?? 0;
    } else {
      counts[entry.table] = await testDatabase.asBackup(
        async (client) => (await client.query<{ n: number }>(query, [accountId])).rows[0]?.n ?? 0,
      );
    }
  }
  return counts;
}

describe('deletion request and cancel (spec 0004, R9)', () => {
  it('ends every session, marks the account due in 7 days, records it and sends the notice', async () => {
    const a = await seeded(testDatabase);
    const dueAt = await deletion.request(a.accountId);
    const days = ((dueAt?.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
    expect(
      (await admin('SELECT count(*)::int AS n FROM auth.session WHERE user_id = $1', [a.accountId]))
        .rows[0],
    ).toEqual({ n: 0 });
    const codes = (await events(a.accountId)).map(({ code }) => code);
    expect(codes).toContain('session_revoked');
    expect(await events(a.accountId)).toContainEqual({
      code: 'deletion_requested',
      actor: a.accountId,
      details: { reason: 'owner_request' },
    });
    expect(sent.map(({ kind, to }) => ({ kind, to }))).toEqual([
      { kind: 'deletion_requested', to: a.email },
    ]);
  });

  it('keeps the first due time on a second request, without a second event or notice', async () => {
    const a = await seeded(testDatabase);
    const first = await deletion.request(a.accountId);
    const second = await deletion.request(a.accountId);
    expect(second).toEqual(first);
    const requested = (await events(a.accountId)).filter(
      ({ code }) => code === 'deletion_requested',
    );
    expect(requested).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it('cancels inside the window and keeps everything', async () => {
    const a = await seeded(testDatabase);
    const before = await ownedCounts(testDatabase, a.accountId);
    await deletion.request(a.accountId);
    expect(await deletion.cancel(a.accountId)).toBe(true);
    expect(await dueAtOf(a.accountId)).toEqual({ due: null });
    expect(await events(a.accountId)).toContainEqual({
      code: 'deletion_cancelled',
      actor: a.accountId,
      details: { reason: 'owner_cancel' },
    });
    expect(await erasureWith().erasable(a.accountId)).toBe(false);
    const after = await ownedCounts(testDatabase, a.accountId);
    // The request ended the session, whose open challenges went with it, and the new events
    // are in the trail; nothing else changed.
    const ended = { 'auth.session': 0, 'auth.passkey_challenge': 0, 'auth.step_up_challenge': 0 };
    expect({ ...after, 'audit.event': before['audit.event'] }).toEqual({ ...before, ...ended });
    expect(await deletion.cancel(a.accountId)).toBe(false);
  });

  it('cannot cancel once the deletion is due, so the erasure owns the account', async () => {
    const a = await seeded(testDatabase);
    await deletion.request(a.accountId);
    await makeDue(a.accountId);
    expect(await deletion.cancel(a.accountId)).toBe(false);
    expect(await erasureWith().erasable(a.accountId)).toBe(true);
  });
});

describe('eraseAccount (spec 0004, R9)', () => {
  it("erases every registry entry's rows, keeps the audit trail and another account's rows", async () => {
    const a = await seeded(testDatabase);
    const b = await seeded(testDatabase);
    const others = await ownedCounts(testDatabase, b.accountId);
    await deletion.request(a.accountId);
    await makeDue(a.accountId);
    sent = [];

    expect(await eraseAccountNow(erasureWith(), a.accountId)).toBe(true);

    const counts = await remaining(a.accountId);
    const retained = registry.entries.filter(({ strategy }) => strategy === 'retain');
    for (const entry of registry.entries) {
      if (entry.strategy === 'delete') expect(counts[entry.table], entry.table).toBe(0);
    }
    for (const { table } of retained) expect(counts[table]).toBeGreaterThan(0);
    const trail = await events(a.accountId);
    expect(trail.at(-1)).toEqual({ code: 'account_erased', actor: null, details: {} });
    expect(JSON.stringify(trail)).not.toContain(a.email);
    expect(await ownedCounts(testDatabase, b.accountId)).toEqual(others);
    expect(sent.map(({ kind, to }) => ({ kind, to }))).toEqual([
      { kind: 'account_erased', to: a.email },
    ]);
    expect(tombstones).toEqual([a.accountId]);
  });

  it('sweeps the expired rows of the tables kept until expiry, and only those', async () => {
    const a = await seeded(testDatabase);
    await makeDue(a.accountId);
    const outbox = `INSERT INTO auth.outbox (recipient, subject, body, expires_at) VALUES ($1, 's', 'b', $2)`;
    const expired = randomUUID();
    const live = randomUUID();
    await admin(outbox, [`${expired}@example.com`, new Date(Date.now() - 60_000)]);
    await admin(outbox, [`${live}@example.com`, new Date(Date.now() + 3_600_000)]);
    await eraseAccountNow(erasureWith(), a.accountId);
    const left = await admin(`SELECT recipient FROM auth.outbox WHERE recipient = ANY ($1)`, [
      [`${expired}@example.com`, `${live}@example.com`],
    ]);
    expect(left.rows).toEqual([{ recipient: `${live}@example.com` }]);
  });

  it('is harmless when run again, also after the tombstone was written', async () => {
    const a = await seeded(testDatabase);
    await makeDue(a.accountId);
    await eraseAccountNow(erasureWith(), a.accountId);
    expect(await due()).not.toContain(a.accountId);
    sent = [];
    expect(await eraseAccountNow(erasureWith(), a.accountId)).toBe(true);
    expect(sent).toEqual([]);
    expect(tombstones).toEqual([a.accountId]);
    const erased = (await events(a.accountId)).filter(({ code }) => code === 'account_erased');
    expect(erased).toHaveLength(1);
    for (const [table, count] of Object.entries(await remaining(a.accountId))) {
      if (table !== 'audit.event') expect(count, table).toBe(0);
    }
  });

  it('keeps an erased account in the scan until its tombstone is written, recording it once', async () => {
    const a = await seeded(testDatabase);
    expect(await due()).not.toContain(a.accountId);
    await makeDue(a.accountId);
    expect(await due()).toContain(a.accountId);
    const failing: Tombstones = { write: () => Promise.reject(new Error('unavailable')) };
    await expect(eraseAccountNow(erasureWith(registry, failing), a.accountId)).rejects.toThrow();
    expect(await dueAtOf(a.accountId)).toBeUndefined();
    expect(await due()).toContain(a.accountId);
    await expect(eraseAccountNow(erasureWith(registry, failing), a.accountId)).rejects.toThrow();

    expect(await eraseAccountNow(erasureWith(), a.accountId)).toBe(true);
    expect(tombstones).toEqual([a.accountId]);
    expect(await due()).not.toContain(a.accountId);
    const erased = (await events(a.accountId)).filter(({ code }) => code === 'account_erased');
    expect(erased).toHaveLength(1);
  });

  it('erases nothing of an account whose deletion is not due', async () => {
    const a = await seeded(testDatabase);
    const before = await ownedCounts(testDatabase, a.accountId);
    expect(await eraseAccountNow(erasureWith(), a.accountId)).toBe(false);
    await deletion.request(a.accountId);
    expect(await eraseAccountNow(erasureWith(), a.accountId)).toBe(false);
    const after = await ownedCounts(testDatabase, a.accountId);
    expect(after['auth.user']).toBe(before['auth.user']);
    expect(after['auth.passkey']).toBe(before['auth.passkey']);
    expect(tombstones).toEqual([]);
  });

  describe('app_jobs entries, under row-level security', () => {
    // A table erased by app_jobs, shaped as a case table will be (ADR-0017).
    const identity = `account_id = nullif(current_setting('app.account_id', true), '')::uuid`;
    const withProbe: Registry = {
      ...registry,
      entries: [
        ...registry.entries,
        {
          table: 'public.erasure_probe',
          strategy: 'delete',
          owner: { column: 'account_id' },
          pool: 'app_jobs',
          export: [],
          label: 'dataExport.tables.probe',
        },
      ],
    };

    beforeAll(async () => {
      await admin(`
        CREATE TABLE public.erasure_probe (account_id uuid NOT NULL);
        ALTER TABLE public.erasure_probe ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.erasure_probe FORCE ROW LEVEL SECURITY;
        CREATE POLICY probe_erase ON public.erasure_probe FOR DELETE TO app_jobs USING (${identity});
        CREATE POLICY probe_read ON public.erasure_probe FOR SELECT TO app_jobs USING (${identity});
        GRANT SELECT, DELETE ON public.erasure_probe TO app_jobs;`);
    });

    const probeRows = async (accountId: string) =>
      (
        await admin('SELECT count(*)::int AS n FROM public.erasure_probe WHERE account_id = $1', [
          accountId,
        ])
      ).rows[0] as { n: number };

    it("erases the account's rows under its identity and leaves another's", async () => {
      const a = randomUUID();
      const b = randomUUID();
      await admin('INSERT INTO public.erasure_probe VALUES ($1), ($1), ($2)', [a, b]);
      await erasureWith(withProbe).eraseOwnedEntries(a);
      expect(await probeRows(a)).toEqual({ n: 0 });
      expect(await probeRows(b)).toEqual({ n: 1 });
    });

    it('reads and erases nothing without an identity', async () => {
      const a = randomUUID();
      await admin('INSERT INTO public.erasure_probe VALUES ($1)', [a]);
      const erased = await testDatabase.jobsDb.execute<{ account_id: string }>(
        sql`DELETE FROM public.erasure_probe RETURNING account_id`,
      );
      expect(erased.rows).toEqual([]);
      const read = await testDatabase.jobsDb.execute<{ account_id: string }>(
        sql`SELECT * FROM public.erasure_probe`,
      );
      expect(read.rows).toEqual([]);
      expect(await probeRows(a)).toEqual({ n: 1 });
    });
  });
});
