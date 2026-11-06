import { DataExport } from '@arca/api-contract/routes';
import { registry, type Registry } from '@arca/db/registry';
import { createI18n, type I18n } from '@arca/i18n';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDataExports, type DataExports } from '../../src/account/data-export.js';
import { auditLog } from '../../src/audit/log.js';
import { authTestDatabase, type AuthTestDatabase } from './auth-database.js';
import { ownedCounts, seeded, unsharedIncome } from './every-table.js';

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

const rowCounts = (document: DataExport) =>
  Object.fromEntries(document.tables.map(({ table, rows }) => [table, rows.length]));

describe('data export (spec 0004, R8)', () => {
  it("gives an account its rows in every registered table, through each projection, and none of another account's", async () => {
    const a = await seeded(testDatabase);
    const b = await seeded(testDatabase);
    // Counted first: the export's own event comes after it.
    const owned = await ownedCounts(testDatabase, a.accountId);
    const document = await exportsWith().build(a.accountId);

    expect(DataExport.parse(document)).toEqual(document);
    expect(document.schemaVersion).toBe(2);
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
    expect(document.case).toEqual({
      people: expect.arrayContaining([
        { displayName: 'Synthetic adult', caseMember: true, keptByMe: true },
        { displayName: 'Synthetic child', caseMember: true, keptByMe: true },
        { displayName: 'Synthetic relative', caseMember: false, keptByMe: false },
        { displayName: 'Synthetic sharer', caseMember: true, keptByMe: false },
      ]) as unknown,
      relationships: expect.arrayContaining([
        { kind: 'parent', from: 'Synthetic adult', to: 'Synthetic child', details: '{}' },
        { kind: 'parent', from: 'Synthetic relative', to: 'Synthetic adult', details: '{}' },
      ]) as unknown,
    });
    const text = JSON.stringify(document);
    // Another keeper's rows stay out, shared with the account or not.
    expect(text).not.toContain(String(unsharedIncome.monthly.amount));
    for (const value of [b.accountId, b.email, b.credentialId]) expect(text).not.toContain(value);
    expect(text).toContain(a.email);
    // Nothing outside the projections, such as an ID or a hash, leaves the database.
    expect(text).not.toContain(a.accountId);
    expect(text).not.toContain(a.credentialId);
  });

  it('writes amounts and shares as exact decimal text', async () => {
    const a = await seeded(testDatabase);
    const document = await exportsWith().build(a.accountId);
    const rowsOf = (name: string) =>
      document.tables.find(({ table }) => table === name)?.rows ?? [];
    expect(rowsOf('cases.asset')[0]?.['value_amount']).toBe('1000');
    expect(rowsOf('cases.asset_owner')[0]?.['share']).toBe('1.000000');
  });

  it('writes timestamps in ISO 8601', async () => {
    const a = await seeded(testDatabase);
    const document = await exportsWith().build(a.accountId);
    const [account] = document.tables.find(({ table }) => table === 'auth.user')?.rows ?? [];
    expect(account?.['created_at']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+00:00$/);
    expect(document.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('records a data_exported event in the account trail', async () => {
    const a = await seeded(testDatabase);
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
    const a = await seeded(testDatabase);
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
