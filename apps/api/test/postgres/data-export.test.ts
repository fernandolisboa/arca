import { randomBytes, randomUUID } from 'node:crypto';
import { DataExport } from '@arca/api-contract/routes';
import { registry, type Registry } from '@arca/db/registry';
import { createI18n, type I18n } from '@arca/i18n';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDataExports, type DataExports } from '../../src/account/data-export.js';
import { auditLog } from '../../src/audit/log.js';
import { authTestDatabase, type AuthTestDatabase } from './auth-database.js';

// The export on the real migrations, through the app_auth and app_api pools (spec 0004, R8).
// Synthetic data only.
let testDatabase: AuthTestDatabase;
let i18n: I18n;

const exportsWith = (checked: Registry = registry): DataExports =>
  createDataExports({
    authDb: testDatabase.authDb,
    apiDb: testDatabase.apiDb,
    audit: auditLog(testDatabase.auditDb),
    i18n,
    registry: checked,
  });

beforeAll(async () => {
  testDatabase = await authTestDatabase();
  i18n = await createI18n();
});

afterAll(async () => {
  await testDatabase.drop();
});

interface Seeded {
  readonly accountId: string;
  readonly email: string;
  readonly credentialId: string;
  readonly codeHash: Buffer;
}

const bytes = (size: number) => randomBytes(size);

/** An account with at least one row in every table of the registry. */
async function seeded(): Promise<Seeded> {
  const accountId = randomUUID();
  const sessionId = randomUUID();
  const email = `person-${randomBytes(6).toString('hex')}@example.com`;
  const credentialId = randomBytes(16).toString('base64url');
  const codeHash = bytes(32);
  await testDatabase.asAdmin(async (client) => {
    const insert = (statement: string, values: unknown[]) => client.query(statement, values);
    await insert(`INSERT INTO auth.user (id, name, email) VALUES ($1, '', $2)`, [accountId, email]);
    await insert(
      `INSERT INTO auth.account (account_id, provider_id, user_id) VALUES ($1, 'passkey', $2)`,
      [accountId, accountId],
    );
    await insert(
      `INSERT INTO auth.passkey (public_key, user_id, credential_id, counter, device_type, backed_up)
       VALUES ('key', $1, $2, 0, 'multiDevice', true)`,
      [accountId, credentialId],
    );
    await insert(
      `INSERT INTO auth.passkey_activation (credential_id, active_from) VALUES ($1, now())`,
      [credentialId],
    );
    await insert(
      `INSERT INTO auth.passkey_capability (credential_id, prf_enabled) VALUES ($1, true)`,
      [credentialId],
    );
    await insert(
      `INSERT INTO auth.passkey_client (credential_id, browser, os) VALUES ($1, 'firefox', 'linux')`,
      [credentialId],
    );
    await insert(
      `INSERT INTO auth.session (id, expires_at, token, user_id, device_browser, device_os, credential_id)
       VALUES ($1, now() + interval '1 day', $2, $3, 'firefox', 'linux', $4)`,
      [sessionId, randomBytes(16).toString('hex'), accountId, credentialId],
    );
    await insert(
      `INSERT INTO auth.passkey_challenge (account_id, session_id, challenge) VALUES ($1, $2, $3)`,
      [accountId, sessionId, bytes(32)],
    );
    await insert(
      `INSERT INTO auth.recovery_code (account_id, salt, code_hash) VALUES ($1, $2, $3)`,
      [accountId, bytes(16), codeHash],
    );
    await insert(`INSERT INTO auth.recovery_link (token_hash, account_id) VALUES ($1, $2)`, [
      bytes(32),
      accountId,
    ]);
    await insert(`INSERT INTO auth.recovery_lock (account_id, failures) VALUES ($1, 1)`, [
      accountId,
    ]);
    await insert(
      `INSERT INTO auth.step_up (account_id, session_id, credential_id, purpose, subject_hash, nonce,
                                 authenticator_data, client_data_json, signature)
       VALUES ($1, $2, $3, 'data_export', $4, $5, $6, $7, $8)`,
      [accountId, sessionId, credentialId, bytes(32), bytes(32), bytes(37), bytes(64), bytes(64)],
    );
    await insert(
      `INSERT INTO auth.step_up_challenge (account_id, session_id, purpose, subject_hash, nonce)
       VALUES ($1, $2, 'data_export', $3, $4)`,
      [accountId, sessionId, bytes(32), bytes(32)],
    );
    await insert(`INSERT INTO auth.invite (inviter_id, email, token_hash) VALUES ($1, $2, $3)`, [
      accountId,
      `invited-${randomBytes(6).toString('hex')}@example.com`,
      bytes(32),
    ]);
    await insert(
      `INSERT INTO audit.event (subject_account_id, actor_account_id, code) VALUES ($1, $2, 'sign_in')`,
      [accountId, accountId],
    );
  });
  return { accountId, email, credentialId, codeHash };
}

/** The account's rows per registry table, counted as the server's admin. */
async function ownedCounts(accountId: string): Promise<Record<string, number>> {
  return testDatabase.asAdmin(async (client) => {
    const counts: Record<string, number> = {};
    for (const entry of registry.entries) {
      const { owner } = entry;
      const parent =
        'column' in owner
          ? undefined
          : registry.entries.find(({ table }) => table === owner.parent);
      const query =
        'column' in owner
          ? `SELECT count(*)::int AS n FROM ${entry.table} WHERE ${owner.column} = $1`
          : `SELECT count(*)::int AS n FROM ${entry.table} t JOIN ${owner.parent} p
               ON t.${owner.columns[0] ?? ''} = p.${owner.parentColumns[0] ?? ''}
             WHERE p.${parent !== undefined && 'column' in parent.owner ? parent.owner.column : ''} = $1`;
      const result = await client.query<{ n: number }>(query, [accountId]);
      counts[entry.table] = result.rows[0]?.n ?? 0;
    }
    return counts;
  });
}

const rowCounts = (document: DataExport) =>
  Object.fromEntries(document.tables.map(({ table, rows }) => [table, rows.length]));

describe('data export (spec 0004, R8)', () => {
  it("gives an account its rows in every registered table, through each projection, and none of another account's", async () => {
    const a = await seeded();
    const b = await seeded();
    // Counted first: the export's own event comes after it.
    const owned = await ownedCounts(a.accountId);
    const document = await exportsWith().build(a.accountId);

    expect(DataExport.parse(document)).toEqual(document);
    expect(document.schemaVersion).toBe(1);
    expect(document.tables.map(({ table }) => table)).toEqual(
      registry.entries.map(({ table }) => table),
    );
    const counts = rowCounts(document);
    expect(counts).toEqual(owned);
    expect(Object.values(counts).every((count) => count >= 1)).toBe(true);
    for (const [index, entry] of registry.entries.entries()) {
      const { label, rows } = document.tables[index] ?? { label: '', rows: [] };
      expect(label).toBe(i18n.t(entry.label as never));
      for (const row of rows) expect(Object.keys(row).sort()).toEqual([...entry.export].sort());
    }
    const text = JSON.stringify(document);
    for (const value of [b.accountId, b.email, b.credentialId]) expect(text).not.toContain(value);
    expect(text).toContain(a.email);
    // Nothing outside the projections, such as an ID or a hash, leaves the database.
    expect(text).not.toContain(a.accountId);
    expect(text).not.toContain(a.credentialId);
  });

  it('writes timestamps in ISO 8601', async () => {
    const a = await seeded();
    const document = await exportsWith().build(a.accountId);
    const [account] = document.tables.find(({ table }) => table === 'auth.user')?.rows ?? [];
    expect(account?.['created_at']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+00:00$/);
    expect(document.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('records a data_exported event in the account trail', async () => {
    const a = await seeded();
    await exportsWith().build(a.accountId);
    const events = await testDatabase.asAdmin((client) =>
      client.query<{ code: string; actor_account_id: string; details: object }>(
        `SELECT code, actor_account_id, details FROM audit.event
          WHERE subject_account_id = $1 AND code = 'data_exported'`,
        [a.accountId],
      ),
    );
    expect(events.rows).toEqual([
      { code: 'data_exported', actor_account_id: a.accountId, details: {} },
    ]);
  });

  it('masks a bytea value with the placeholder and carries none of its bytes', async () => {
    const a = await seeded();
    const withHash: Registry = {
      ...registry,
      entries: registry.entries.map((entry) =>
        entry.table === 'auth.recovery_code'
          ? { ...entry, export: [...entry.export, 'code_hash'] }
          : entry,
      ),
    };
    const document = await exportsWith(withHash).build(a.accountId);
    const [code] = document.tables.find(({ table }) => table === 'auth.recovery_code')?.rows ?? [];
    expect(code?.['code_hash']).toBe(i18n.t('dataExport.masked'));
    const text = JSON.stringify(document);
    expect(text).not.toContain(a.codeHash.toString('hex'));
    expect(text).not.toContain(a.codeHash.toString('base64'));
  });
});
