import { createECDH, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { clientFor, type ConnectionTarget } from './connection.ts';
import { checkDeploymentTarget, checkLineage, type Deployment } from './deployment-target.ts';

/** A synthetic account with one passkey, as `packages/db/seed/accounts.json` lists it. */
export interface SeedAccount {
  readonly id: string;
  readonly email: string;
  readonly confirmedAt: string;
  readonly passkey: { readonly id: string; readonly label: string };
}

export const seedRole = 'app_auth';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const syntheticEmail = /^[a-z0-9-]{1,40}@example\.com$/;
const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const labelPattern = /^[a-z0-9 :-]{1,80}$/;

function record(value: unknown, keys: readonly string[], where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} is not an object`);
  }
  const actual = Object.keys(value).sort();
  if (actual.join() !== [...keys].sort().join()) {
    throw new Error(`${where} must have exactly ${keys.join(', ')}`);
  }
  return value as Record<string, unknown>;
}

function matching(value: unknown, pattern: RegExp, where: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`${where} is malformed`);
  return value;
}

/** Parses the seed file; only synthetic `example.com` addresses are accepted (spec 0004, R2). */
export function parseSeedAccounts(text: string): SeedAccount[] {
  const { accounts } = record(JSON.parse(text), ['accounts'], 'the seed');
  if (!Array.isArray(accounts)) throw new Error('the seed accounts are not a list');
  const parsed = accounts.map((entry: unknown, index): SeedAccount => {
    const where = `seed account ${String(index)}`;
    const account = record(entry, ['id', 'email', 'confirmedAt', 'passkey'], where);
    const passkey = record(account['passkey'], ['id', 'label'], `${where} passkey`);
    return {
      id: matching(account['id'], uuidPattern, `${where} id`),
      email: matching(account['email'], syntheticEmail, `${where} email`),
      confirmedAt: matching(account['confirmedAt'], isoInstant, `${where} confirmedAt`),
      passkey: {
        id: matching(passkey['id'], uuidPattern, `${where} passkey id`),
        label: matching(passkey['label'], labelPattern, `${where} passkey label`),
      },
    };
  });
  const ids = parsed.flatMap((account) => [account.id, account.passkey.id]);
  if (new Set(ids).size !== ids.length) throw new Error('the seed repeats an ID');
  return parsed;
}

export async function readSeedAccounts(file: string): Promise<SeedAccount[]> {
  return parseSeedAccounts(await readFile(file, 'utf8'));
}

/**
 * The seed passkey's credential ID and COSE public key. Its P-256 private key is the SHA-256 of
 * the public label, so anyone can compute it: it guards synthetic accounts on previews, which sit
 * behind Deployment Protection, and lets a test sign in with a virtual authenticator.
 */
export function seedPasskeyCredential(label: string): {
  credentialId: string;
  publicKey: string;
} {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(createHash('sha256').update(label).digest());
  const point = ecdh.getPublicKey();
  const cose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    point.subarray(1, 33),
    Buffer.from([0x22, 0x58, 0x20]),
    point.subarray(33, 65),
  ]);
  return {
    credentialId: Buffer.from(label).toString('base64url'),
    publicKey: cose.toString('base64'),
  };
}

/** A production build reached the seed (spec 0004, R2). */
export class SeedRefusedInProduction extends Error {
  readonly code = 'seed_refused_in_production';

  constructor() {
    super('seed_refused_in_production: production never holds the synthetic seed (spec 0004 R2)');
  }
}

/**
 * Writes the synthetic accounts as app_auth, in one transaction, leaving rows that exist alone so
 * a second run changes nothing. A preview checks the database target and the lineage mark first.
 */
export async function seed(
  target: ConnectionTarget,
  accounts: readonly SeedAccount[],
  deployment: Deployment | undefined,
): Promise<void> {
  if (deployment === 'production') throw new SeedRefusedInProduction();
  if (target.user !== seedRole) throw new Error(`the seed connects as ${seedRole}`);
  const client = clientFor(target, 'arca-seed');
  await client.connect();
  try {
    await client.query('BEGIN');
    try {
      if (deployment === 'preview') {
        await checkDeploymentTarget(client, deployment, target.host, { mayMark: false });
        await checkLineage(client, deployment);
      }
      for (const account of accounts) {
        const { credentialId, publicKey } = seedPasskeyCredential(account.passkey.label);
        await client.query(
          `INSERT INTO auth."user" (id, name, email, email_verified, confirmed_at)
           VALUES ($1, '', $2, true, $3) ON CONFLICT (id) DO NOTHING`,
          [account.id, account.email, account.confirmedAt],
        );
        await client.query(
          `INSERT INTO auth.passkey (id, public_key, user_id, credential_id, counter, device_type, backed_up)
           VALUES ($1, $2, $3, $4, 0, 'multiDevice', true) ON CONFLICT (id) DO NOTHING`,
          [account.passkey.id, publicKey, account.id, credentialId],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.end();
  }
}
