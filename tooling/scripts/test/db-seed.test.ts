import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSeedAccounts, seed, seedPasskeyCredential } from '../src/db/seed.ts';

const seedFile = join(import.meta.dirname, '../../../packages/db/seed/accounts.json');

const account = {
  id: '00000000-5eed-4000-8000-000000000001',
  email: 'seed-owner@example.com',
  confirmedAt: '2026-01-01T00:00:00.000Z',
  passkey: { id: '00000000-5eed-4000-8000-000000000101', label: 'arca synthetic seed: owner' },
};
const withAccount = (changed: Record<string, unknown>) =>
  JSON.stringify({ accounts: [{ ...account, ...changed }] });

describe('parseSeedAccounts', () => {
  it('reads the committed seed', async () => {
    const accounts = parseSeedAccounts(await readFile(seedFile, 'utf8'));
    expect(accounts.length).toBeGreaterThan(0);
    for (const { email } of accounts) expect(email).toMatch(/@example\.com$/);
  });

  it.each([
    ['a real-looking address', { email: 'someone@gmail.com' }, 'email is malformed'],
    ['a subdomain of example.com', { email: 'a@mail.example.com.br' }, 'email is malformed'],
    ['an ID that is not a UUID', { id: 'owner' }, 'id is malformed'],
    ['a date that is not an instant', { confirmedAt: '2026-01-01' }, 'confirmedAt is malformed'],
    ['an unknown field', { name: 'Ana' }, 'must have exactly'],
  ])('refuses %s', (_case, changed, message) => {
    expect(() => parseSeedAccounts(withAccount(changed))).toThrow(message);
  });

  it('refuses a repeated ID', () => {
    const repeated = { ...account, passkey: { ...account.passkey, id: account.id } };
    expect(() => parseSeedAccounts(JSON.stringify({ accounts: [repeated] }))).toThrow(
      'repeats an ID',
    );
  });
});

describe('seedPasskeyCredential', () => {
  it('derives the same P-256 COSE key from the same label, and another from another', () => {
    const first = seedPasskeyCredential('arca synthetic seed: owner');
    expect(seedPasskeyCredential('arca synthetic seed: owner')).toEqual(first);
    expect(Buffer.from(first.publicKey, 'base64')).toHaveLength(77);
    expect(Buffer.from(first.credentialId, 'base64url').toString()).toBe(
      'arca synthetic seed: owner',
    );
    expect(seedPasskeyCredential('arca synthetic seed: member').publicKey).not.toBe(
      first.publicKey,
    );
  });
});

describe('seed', () => {
  // Nothing listens on this port: a refusal must come before any connection.
  const unreachable = {
    host: '127.0.0.1',
    port: 1,
    database: 'arca',
    user: 'app_auth',
    password: 'synthetic',
    ssl: false,
  };

  it('refuses a production run before it connects', async () => {
    await expect(seed(unreachable, [], 'production')).rejects.toThrow('seed_refused_in_production');
  });

  it('refuses any role but app_auth before it connects', async () => {
    await expect(seed({ ...unreachable, user: 'app_migrator' }, [], 'preview')).rejects.toThrow(
      'the seed connects as app_auth',
    );
  });
});
