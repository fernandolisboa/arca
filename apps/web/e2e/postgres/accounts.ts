import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { databaseServer } from '../servers.js';

/** The disposable server, as its admin; every connection field is explicit. */
function adminClient(): pg.Client {
  const password = process.env['ARCA_TEST_DB_ADMIN_PASSWORD'] ?? '';
  if (password === '') throw new Error('ARCA_TEST_DB_ADMIN_PASSWORD is not set');
  return new pg.Client({
    host: databaseServer.database.host,
    port: databaseServer.database.port,
    database: databaseServer.database.name,
    user: process.env['ARCA_TEST_DB_ADMIN_USER'] ?? 'postgres',
    password,
  });
}

async function asAdmin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = adminClient();
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** An account of the synthetic seed, as `packages/db/seed/accounts.json` lists it. */
export interface SeededAccount {
  readonly id: string;
  readonly email: string;
  readonly passkey: { readonly id: string; readonly label: string };
}

/**
 * Runs the seed command a preview build runs (spec 0004, R2) against the e2e database, as
 * app_auth, and returns the accounts it seeds.
 */
export async function runSeed(): Promise<readonly SeededAccount[]> {
  const password = process.env['ARCA_DB_AUTH_PASSWORD'] ?? '';
  if (password === '') throw new Error('ARCA_DB_AUTH_PASSWORD is not set');
  await promisify(execFile)(
    process.execPath,
    [fileURLToPath(new URL('../../../../tooling/scripts/src/db/cli.ts', import.meta.url)), 'seed'],
    {
      env: {
        PGHOST_UNPOOLED: databaseServer.database.host,
        PGPORT: String(databaseServer.database.port),
        PGDATABASE: databaseServer.database.name,
        ARCA_DB_AUTH_PASSWORD: password,
      },
    },
  );
  const file = new URL('../../../../packages/db/seed/accounts.json', import.meta.url);
  return (JSON.parse(await readFile(file, 'utf8')) as { accounts: SeededAccount[] }).accounts;
}

/** A synthetic account with one passkey; `userId` when the credential already names its user. */
export async function seedAccount(
  {
    credentialId,
    publicKey,
  }: {
    readonly credentialId: string;
    readonly publicKey: string;
  },
  userId: string = randomUUID(),
  { confirmed = false }: { readonly confirmed?: boolean } = {},
): Promise<{ userId: string; email: string }> {
  const email = `e2e-${userId}@example.com`;
  await asAdmin(async (client) => {
    await client.query(
      `INSERT INTO auth."user" (id, name, email, email_verified, confirmed_at)
       VALUES ($1, '', $2, true, CASE WHEN $3 THEN now() END)`,
      [userId, email, confirmed],
    );
    await client.query(
      `INSERT INTO auth.passkey (public_key, user_id, credential_id, counter, device_type, backed_up)
       VALUES ($1, $2, $3, 0, 'multiDevice', true)`,
      [publicKey, userId, credentialId],
    );
  });
  return { userId, email };
}

/** Another active passkey on the account, as one created on a device that is now lost. */
export async function seedPasskey(
  userId: string,
  { credentialId, publicKey }: { readonly credentialId: string; readonly publicKey: string },
): Promise<void> {
  await asAdmin((client) =>
    client.query(
      `INSERT INTO auth.passkey (public_key, user_id, credential_id, counter, device_type, backed_up)
       VALUES ($1, $2, $3, 0, 'multiDevice', true)`,
      [publicKey, userId, credentialId],
    ),
  );
}

/** An audit event with no details, as the flow that records it would leave it. */
export async function recordEvent(userId: string, code: 'recovery_completed'): Promise<void> {
  await asAdmin((client) =>
    client.query(
      `INSERT INTO audit.event (subject_account_id, actor_account_id, code) VALUES ($1, $1, $2)`,
      [userId, code],
    ),
  );
}

/** The account's stored sharing state, as a database snapshot would hold it. */
export interface StoredSharingState {
  readonly version: number;
  readonly state: Buffer;
  readonly tag: Buffer;
}

export async function sharingStateOf(userId: string): Promise<StoredSharingState> {
  const { rows } = await asAdmin((client) =>
    client.query<StoredSharingState>(
      'SELECT version, state, tag FROM vault.sharing_state WHERE account_id = $1',
      [userId],
    ),
  );
  const [row] = rows;
  if (row === undefined) throw new Error('no sharing state stored');
  return row;
}

/** Puts an older snapshot back, as a restore of the database would. */
export async function restoreSharingState(
  userId: string,
  { version, state, tag }: StoredSharingState,
): Promise<void> {
  await asAdmin((client) =>
    client.query(
      'UPDATE vault.sharing_state SET version = $2, state = $3, tag = $4 WHERE account_id = $1',
      [userId, version, state, tag],
    ),
  );
}

/** A recipient row the server added to the owner's only document, outside the sharing state. */
export async function addRecipientRow(ownerId: string, recipientId: string): Promise<string> {
  const { rows } = await asAdmin((client) =>
    client.query<{ id: string }>(
      `INSERT INTO vault.document_recipient (document_id, document_owner_id, recipient_id)
       SELECT id, owner_id, $2 FROM vault.document WHERE owner_id = $1
       RETURNING document_id AS id`,
      [ownerId, recipientId],
    ),
  );
  const [row] = rows;
  if (row === undefined) throw new Error('the owner has no document');
  return row.id;
}

/** The link a confirmed invite leaves between two accounts (spec 0005, R4). */
export async function linkAccounts(inviterId: string, inviteeId: string): Promise<void> {
  await asAdmin(async (client) => {
    await client.query(`INSERT INTO account.link (inviter_id, invitee_id) VALUES ($1, $2)`, [
      inviterId,
      inviteeId,
    ]);
  });
}

/**
 * A local server counts every request as one client, so repeated local runs would reach the
 * per-IP limits; each run starts from fresh counters.
 */
export async function resetRateLimits(): Promise<void> {
  await asAdmin(async (client) => {
    await client.query('DELETE FROM auth.rate_limit');
  });
}

/**
 * Starts a seed passkey's signature counter over, so a fresh virtual authenticator, whose counter
 * also starts over, signs in with it again.
 */
export async function restartSeededCounter(accountId: string): Promise<void> {
  await asAdmin(async (client) => {
    await client.query('UPDATE auth.passkey SET counter = 0 WHERE user_id = $1', [accountId]);
  });
}

/** Empties the knowledge decisions, which no role may delete, so every version is proposed. */
export async function clearKnowledgeDecisions(): Promise<void> {
  await asAdmin(async (client) => {
    await client.query('TRUNCATE knowledge.decision');
  });
}

/** Empties the correction requests, which no runtime role deletes outside erasure. */
export async function clearCorrectionRequests(): Promise<void> {
  await asAdmin(async (client) => {
    await client.query('TRUNCATE knowledge.correction_request CASCADE');
  });
}

/** Empties the check starts, which no role may delete, so the automatic share starts over. */
export async function clearCheckStarts(): Promise<void> {
  await asAdmin(async (client) => {
    await client.query('TRUNCATE knowledge.check_start');
  });
}

/**
 * Starts the admin role over for an owner-list account (ADR-0027): no grant history, which no role
 * may delete, and the account in no case, so it can start one.
 */
export async function startOverAdmins(ownerId: string): Promise<void> {
  await asAdmin(async (client) => {
    await client.query('TRUNCATE knowledge.admin_grant');
    await client.query('DELETE FROM cases.member WHERE account_id = $1', [ownerId]);
  });
}

/**
 * The first account is created once per database, so the enrollment tests start from one with no
 * account, no spent enrollment code and no pending link, and run before any test seeds an account.
 */
export async function resetEnrollment(): Promise<void> {
  if (!databaseServer.database.name.includes('e2e')) {
    throw new Error('the enrollment tests empty their database, so its name must contain "e2e"');
  }
  await asAdmin(async (client) => {
    await client.query('DELETE FROM auth."user"');
    await client.query('DELETE FROM auth.setup');
    await client.query('DELETE FROM auth.registration_context');
    await client.query('DELETE FROM auth.outbox');
    await client.query('DELETE FROM auth.rate_limit');
  });
}

/** The newest message the outbox holds for an address, of those whose body has the text. */
export async function latestEmailTo(
  recipient: string,
  containing = '',
): Promise<string | undefined> {
  return asAdmin(async (client) => {
    const { rows } = await client.query<{ body: string }>(
      `SELECT body FROM auth.outbox WHERE recipient = $1 AND strpos(body, $2) > 0
        ORDER BY created_at DESC LIMIT 1`,
      [recipient, containing],
    );
    return rows[0]?.body;
  });
}

const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A saved recovery kit for the account; the code, as the kit shows it, is returned. */
export async function seedRecoveryCode(userId: string): Promise<string> {
  const code = Array.from(randomBytes(26), (byte) => crockford.charAt(byte % 32)).join('');
  const salt = randomBytes(16);
  const codeHash = createHash('sha256').update(salt).update(code, 'utf8').digest();
  await asAdmin((client) =>
    client.query(
      `INSERT INTO auth.recovery_code (account_id, salt, code_hash, confirmed_at)
       VALUES ($1, $2, $3, now())`,
      [userId, salt, codeHash],
    ),
  );
  return code;
}

/** Ends the 24-hour wait of every pending passkey of the account. */
export async function endPasskeyWaits(userId: string): Promise<void> {
  await asAdmin((client) =>
    client.query(
      `UPDATE auth.passkey_activation SET active_from = now() - interval '1 second'
        WHERE credential_id IN (SELECT credential_id FROM auth.passkey WHERE user_id = $1)`,
      [userId],
    ),
  );
}

/** What the database recorded about an account's passkeys and recovery kit. */
export async function enrolledAccount(email: string) {
  return asAdmin(async (client) => {
    const { rows } = await client.query<{
      confirmed: boolean;
      prf_enabled: boolean | null;
      kit_saved: boolean | null;
    }>(
      `SELECT u.confirmed_at IS NOT NULL AS confirmed, c.prf_enabled,
              k.confirmed_at IS NOT NULL AS kit_saved
         FROM auth."user" u
         LEFT JOIN auth.passkey p ON p.user_id = u.id
         LEFT JOIN auth.passkey_capability c ON c.credential_id = p.credential_id
         LEFT JOIN auth.recovery_code k ON k.account_id = u.id
        WHERE u.email = $1`,
      [email],
    );
    return rows;
  });
}

/** Erases every account, as an erasure would (spec 0004). */
export async function deleteAccounts(): Promise<void> {
  await asAdmin(async (client) => {
    await client.query('DELETE FROM auth."user"');
  });
}

/** A push channel for the account, as a browser on Android would add it; its ID is returned. */
export async function seedPushChannel(userId: string): Promise<string> {
  const result = await asAdmin((client) =>
    client.query<{ id: string }>(
      `INSERT INTO notification.channel
              (account_id, kind, endpoint, p256dh, auth_secret, browser, os)
       VALUES ($1, 'web_push', $2, $3, $4, 'chrome', 'android') RETURNING id`,
      [
        userId,
        `https://fcm.googleapis.com/fcm/send/e2e-${randomUUID()}`,
        `B${'C'.repeat(86)}`,
        'D'.repeat(22),
      ],
    ),
  );
  const [row] = result.rows;
  if (row === undefined) throw new Error('no push channel seeded');
  return row.id;
}

/** The kinds of the account's notification channels, in creation order. */
export async function channelKinds(userId: string): Promise<string[]> {
  const result = await asAdmin((client) =>
    client.query<{ kind: string }>(
      `SELECT kind FROM notification.channel WHERE account_id = $1 ORDER BY created_at, id`,
      [userId],
    ),
  );
  return result.rows.map(({ kind }) => kind);
}
