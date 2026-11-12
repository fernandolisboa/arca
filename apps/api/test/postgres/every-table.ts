import { randomBytes, randomUUID } from 'node:crypto';
import { registry } from '@arca/db/registry';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ownedRows } from '../../src/account/data-export.js';
import type { AuthTestDatabase } from './auth-database.js';

// Synthetic accounts with rows in every registry table (spec 0004, R7 to R9).

export interface Seeded {
  readonly accountId: string;
  readonly email: string;
  readonly credentialId: string;
  readonly codeHash: Buffer;
  /** Another member of the account's case, with no account of its own here. */
  readonly sharerId: string;
}

const bytes = (size: number) => randomBytes(size);

/** Another keeper's income, never shared with the seeded account, so its export must not hold it. */
export const unsharedIncome = {
  kind: 'active',
  monthly: { amount: 987654321, currency: 'BRL' },
  sourceCountry: 'BR',
} as const;

/** An account with at least one row in every table of the registry. */
export async function seeded(testDatabase: AuthTestDatabase): Promise<Seeded> {
  const accountId = randomUUID();
  const sessionId = randomUUID();
  const email = `person-${randomBytes(6).toString('hex')}@example.com`;
  const credentialId = randomBytes(16).toString('base64url');
  const codeHash = bytes(32);
  const sharerId = randomUUID();
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
    const recipientId = randomUUID();
    await insert(`INSERT INTO vault.recipient (id, account_id, recipient) VALUES ($1, $2, $3)`, [
      recipientId,
      accountId,
      'age1pq1qqqq',
    ]);
    await insert(
      `INSERT INTO vault.envelope (account_id, recipient_id, kind, credential_id, ciphertext)
       VALUES ($1, $2, 'passkey_prf', $3, $4), ($1, $2, 'recovery', NULL, $4)`,
      [accountId, recipientId, credentialId, bytes(256)],
    );
    await insert(
      `INSERT INTO vault.sharing_state (account_id, version, state, tag) VALUES ($1, 1, $2, $3)`,
      [accountId, Buffer.from('{}'), bytes(32)],
    );
    const sharedId = randomUUID();
    await insert(`INSERT INTO account.link (inviter_id, invitee_id) VALUES ($1, $2), ($3, $1)`, [
      accountId,
      randomUUID(),
      sharerId,
    ]);
    const ownedId = randomUUID();
    await insert(
      `INSERT INTO vault.document (id, owner_id, type_key, size, sha256, object_key, label)
       VALUES ($1, $2, 'passport', 1024, $3, $4, decode('01', 'hex')), ($5, $6, 'passport', 2048, $3, $7, decode('01', 'hex'))`,
      [
        ownedId,
        accountId,
        bytes(32),
        `documents/${randomUUID()}`,
        sharedId,
        sharerId,
        `documents/${randomUUID()}`,
      ],
    );
    await insert(
      `INSERT INTO vault.document_recipient (document_id, document_owner_id, recipient_id)
       VALUES ($1, $2, $3)`,
      [sharedId, sharerId, accountId],
    );
    await insert(
      `INSERT INTO vault.document_replacement
         (document_id, owner_id, size, sha256, object_key, label, recipients)
       VALUES ($1, $2, 512, $3, $4, decode('01', 'hex'), '{}')`,
      [ownedId, accountId, bytes(32), `documents/${randomUUID()}`],
    );
    await insert(`INSERT INTO vault.discarded_object (object_key, owner_id) VALUES ($1, $2)`, [
      `documents/${randomUUID()}`,
      accountId,
    ]);
    const channelId = randomUUID();
    const messageId = randomUUID();
    await insert(
      `INSERT INTO notification.channel (id, account_id, kind, endpoint, p256dh, auth_secret, browser, os)
       VALUES ($1, $2, 'web_push', 'https://push.example.com/send/1', $3, $4, 'firefox', 'linux')`,
      [channelId, accountId, bytes(65).toString('base64url'), bytes(16).toString('base64url')],
    );
    await insert(
      `INSERT INTO notification.message (id, account_id, code) VALUES ($1, $2, 'passkey_added')`,
      [messageId, accountId],
    );
    await insert(
      `INSERT INTO notification.delivery (account_id, message_id, channel_id) VALUES ($1, $2, $3)`,
      [accountId, messageId, channelId],
    );
    // A case the account shares with a sharer, which keeps a person of its own there.
    const caseId = randomUUID();
    const selfId = randomUUID();
    const childId = randomUUID();
    const relativeId = randomUUID();
    const sharerPersonId = randomUUID();
    const assetId = randomUUID();
    await insert(`INSERT INTO cases.case_file (id) VALUES ($1)`, [caseId]);
    await insert(`INSERT INTO cases.member (account_id, case_id) VALUES ($1, $2), ($3, $2)`, [
      accountId,
      caseId,
      sharerId,
    ]);
    await insert(
      `INSERT INTO cases.person (id, case_id, keeper_account_id, account_id, display_name, case_member)
       VALUES ($1, $4, $5, $5, 'Synthetic adult', true), ($2, $4, $5, NULL, 'Synthetic child', true),
              ($3, $4, $6, NULL, 'Synthetic relative', false),
              ($7, $4, $6, $6, 'Synthetic sharer', true)`,
      [selfId, childId, relativeId, caseId, accountId, sharerId, sharerPersonId],
    );
    await insert(
      `INSERT INTO cases.person_profile (person_id, facts, dependence_answered) VALUES ($1, '{}', true)`,
      [childId],
    );
    await insert(
      `INSERT INTO cases.person_finances (person_id, incomes, assets_recorded_in_full) VALUES ($1, '[]', true)`,
      [selfId],
    );
    // The sharer's relative: a profile shared with the account, finances that are not.
    await insert(
      `INSERT INTO cases.person_profile (person_id, facts, dependence_answered) VALUES ($1, '{}', false)`,
      [relativeId],
    );
    await insert(
      `INSERT INTO cases.person_finances (person_id, incomes, assets_recorded_in_full)
       VALUES ($1, $2, false)`,
      [relativeId, JSON.stringify([unsharedIncome])],
    );
    await insert(
      `INSERT INTO cases.share (case_id, person_id, grantee_account_id, scope) VALUES ($1, $2, $3, 'profile')`,
      [caseId, relativeId, accountId],
    );
    await insert(
      `INSERT INTO cases.dependence (case_id, person_id, depends_on_id) VALUES ($1, $2, $3)`,
      [caseId, childId, selfId],
    );
    await insert(
      `INSERT INTO cases.relationship (case_id, kind, from_person_id, to_person_id)
       VALUES ($1, 'parent', $2, $3), ($1, 'parent', $4, $2)`,
      [caseId, selfId, childId, relativeId],
    );
    await insert(
      `INSERT INTO cases.share (case_id, person_id, grantee_account_id, scope) VALUES ($1, $2, $3, 'profile')`,
      [caseId, childId, sharerId],
    );
    await insert(
      `INSERT INTO cases.asset (id, case_id, kind, value_amount, value_currency, valued_at)
       VALUES ($1, $2, 'cash', 1000, 'BRL', '2026-01-01')`,
      [assetId, caseId],
    );
    await insert(
      `INSERT INTO cases.asset_owner (case_id, asset_id, person_id, share, confirmed) VALUES ($1, $2, $3, 1, true)`,
      [caseId, assetId, selfId],
    );
    await insert(
      `INSERT INTO cases.rule_report (case_id, reporter_account_id, route_id, version_number, requirement_id, reason, note)
       VALUES ($1, $2, 'qm-sample', 1, 'adult', 'outdated', 'Synthetic note')`,
      [caseId, accountId],
    );
    const correctionId = randomUUID();
    await insert(
      `INSERT INTO knowledge.correction_request (id, route_id, version_number, item_kind, item_key, note, author_account_id)
       VALUES ($1, 'qm-sample', 1, 'requirement', 'adult', 'Synthetic note', $2)`,
      [correctionId, accountId],
    );
    await insert(
      `INSERT INTO knowledge.correction_source (request_id, position, kind, url) VALUES ($1, 0, 'link', 'https://example.gov/law')`,
      [correctionId],
    );
    await insert(
      `INSERT INTO knowledge.correction_event (request_id, kind) VALUES ($1, 'closed')`,
      [correctionId],
    );
    await insert(
      `INSERT INTO cases.comparison_preferences (account_id, case_id, preferences)
       VALUES ($1, $2, '{"weights": {"climate": 4}, "ratings": {}, "ownCriteria": [], "hidden": []}')`,
      [accountId, caseId],
    );
    await insert(
      `INSERT INTO audit.event (subject_account_id, actor_account_id, code) VALUES ($1, $2, 'sign_in')`,
      [accountId, accountId],
    );
    await insert(
      `INSERT INTO knowledge.decision (kind, subject_kind, route_id, version_number, content_hash,
         approver_account_id, proof, credential_id, public_key, action_nonce, server_nonce,
         authenticator_data, client_data_json, signature, step_up_id)
       VALUES ('reject', 'route', 'qm-sample', 1, repeat('a', 64), $1, 'step_up', $2, '\\x00', decode(repeat('ab', 16), 'hex'),
         decode(repeat('ab', 32), 'hex'), '\\x00', '\\x00', '\\x00', gen_random_uuid())`,
      [accountId, credentialId],
    );
    await insert(
      `INSERT INTO knowledge.admin_grant (kind, grantee_account_id, actor_account_id, actor_basis, step_up_id)
       VALUES ('grant', $1, $2, 'owner_list', gen_random_uuid())`,
      [accountId, sharerId],
    );
  });
  return { accountId, email, credentialId, codeHash, sharerId };
}

const dialect = new PgDialect();

/** The account's rows per registry table, counted as the server's admin. */
export async function ownedCounts(
  testDatabase: AuthTestDatabase,
  accountId: string,
): Promise<Record<string, number>> {
  return testDatabase.asAdmin(async (client) => {
    const counts: Record<string, number> = {};
    for (const entry of registry.entries) {
      // The export's own selection, rendered for the admin client, which sees past every policy.
      const query = dialect.sqlToQuery(
        sql`SELECT count(*)::int AS n ${ownedRows(entry, registry, accountId)}`,
      );
      const result = await client.query<{ n: number }>(query.sql, query.params);
      counts[entry.table] = result.rows[0]?.n ?? 0;
    }
    return counts;
  });
}
