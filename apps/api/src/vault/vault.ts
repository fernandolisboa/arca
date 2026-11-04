import type {
  PasskeyEnvelope,
  SetUpVaultRequest,
  VaultEnvelopesResponse,
  VaultStatusResponse,
} from '@arca/api-contract/routes';
import { withIdentity, type Database, type Transaction } from '@arca/db';
import { envelope, recipient } from '@arca/db/vault-schema';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';

export type VaultSetUp = 'created' | 'exists' | 'unknown_passkey';
export type EnvelopeAdded = 'added' | 'no_vault' | 'unknown_passkey';

/**
 * The vault's server side (spec 0005, R2): it stores what the device sealed and serves it back,
 * and never sees an identity or a secret. Every query runs as app_api under the account's
 * identity; the routes check the `vault_unlock` window before calling anything but `status`.
 */
export interface Vault {
  readonly status: (accountId: string) => Promise<VaultStatusResponse>;
  readonly setUp: (accountId: string, request: SetUpVaultRequest) => Promise<VaultSetUp>;
  /**
   * The recipients still kept and their envelopes, recorded as fetched; a passkey envelope only
   * for an active passkey, so one a failed revocation left behind is never served. Null before
   * set-up.
   */
  readonly envelopes: (accountId: string) => Promise<VaultEnvelopesResponse | null>;
  /** Stores a passkey's envelope for the current recipient, keeping one already there. */
  readonly addEnvelope: (accountId: string, sealed: PasskeyEnvelope) => Promise<EnvelopeAdded>;
  /** Deletes the passkey's envelopes, for every recipient; idempotent. */
  readonly forgetPasskey: (accountId: string, credentialId: string) => Promise<void>;
}

export interface VaultSettings {
  /** A database on the app_api pool. */
  readonly db: Database;
  /** The credential IDs of the account's active passkeys, read on the app_auth pool. */
  readonly activeCredentials: (accountId: string) => Promise<readonly string[]>;
  readonly audit: AuditLog;
}

const bytes = (base64url: string) => Buffer.from(base64url, 'base64url');

interface NewEnvelope {
  readonly kind: 'passkey_prf' | 'recovery';
  readonly credentialId: string | null;
  readonly ciphertext: string;
}

// The inserts name only the columns app_api may set: Drizzle's builder lists every column.

/** The new current recipient's ID, or none when the account already has one. */
const insertRecipient = async (tx: Transaction, accountId: string, value: string) =>
  (
    await tx.execute<{ id: string }>(sql`
      INSERT INTO vault.recipient (account_id, recipient) VALUES (${accountId}, ${value})
      ON CONFLICT DO NOTHING RETURNING id`)
  ).rows[0]?.id;

/** Keeps an envelope already stored for the same recipient and passkey. */
const insertEnvelopes = (
  tx: Transaction,
  accountId: string,
  recipientId: string,
  rows: readonly NewEnvelope[],
) =>
  tx.execute(sql`
    INSERT INTO vault.envelope (account_id, recipient_id, kind, credential_id, ciphertext)
    VALUES ${sql.join(
      rows.map(
        ({ kind, credentialId, ciphertext }) =>
          sql`(${accountId}, ${recipientId}, ${kind}, ${credentialId}, ${bytes(ciphertext)})`,
      ),
      sql`, `,
    )}
    ON CONFLICT DO NOTHING`);

const current = (tx: Transaction, accountId: string) =>
  tx
    .select({ id: recipient.id, recipient: recipient.recipient })
    .from(recipient)
    .where(and(eq(recipient.accountId, accountId), isNull(recipient.rotatedAt)))
    .then(([found]) => found);

export function createVault({ db, activeCredentials, audit }: VaultSettings): Vault {
  const asAccount = <T>(accountId: string, work: (tx: Transaction) => Promise<T>) =>
    withIdentity(db, { accountId }, work);

  const allActive = async (accountId: string, credentialIds: readonly string[]) => {
    const active = new Set(await activeCredentials(accountId));
    return credentialIds.every((id) => active.has(id));
  };

  return {
    status: async (accountId) => ({
      recipient: (await asAccount(accountId, (tx) => current(tx, accountId)))?.recipient ?? null,
    }),

    setUp: async (accountId, { recipient: newRecipient, passkeyEnvelopes, recoveryEnvelope }) => {
      if (
        !(await allActive(
          accountId,
          passkeyEnvelopes.map(({ credentialId }) => credentialId),
        ))
      ) {
        return 'unknown_passkey';
      }
      // A current recipient already there, or one a concurrent set-up stored first, conflicts
      // with the one-current-recipient index, so nothing is stored.
      return asAccount(accountId, async (tx) => {
        const recipientId = await insertRecipient(tx, accountId, newRecipient);
        if (recipientId === undefined) return 'exists' as const;
        await insertEnvelopes(tx, accountId, recipientId, [
          { kind: 'recovery', credentialId: null, ciphertext: recoveryEnvelope },
          ...passkeyEnvelopes.map(({ credentialId, ciphertext }) => ({
            kind: 'passkey_prf' as const,
            credentialId,
            ciphertext,
          })),
        ]);
        return 'created' as const;
      });
    },

    envelopes: async (accountId) => {
      const active = await activeCredentials(accountId);
      const found = await asAccount(accountId, async (tx) => {
        const recipients = await tx
          .select({
            id: recipient.id,
            recipient: recipient.recipient,
            rotatedAt: recipient.rotatedAt,
          })
          .from(recipient)
          .where(eq(recipient.accountId, accountId))
          .orderBy(asc(recipient.createdAt), asc(recipient.id));
        if (!recipients.some(({ rotatedAt }) => rotatedAt === null)) return null;
        const envelopes = await tx
          .select({
            recipientId: envelope.recipientId,
            kind: envelope.kind,
            credentialId: envelope.credentialId,
            ciphertext: envelope.ciphertext,
          })
          .from(envelope)
          .where(
            and(
              eq(envelope.accountId, accountId),
              or(
                eq(envelope.kind, 'recovery'),
                active.length === 0 ? undefined : inArray(envelope.credentialId, [...active]),
              ),
            ),
          )
          .orderBy(asc(envelope.createdAt), asc(envelope.id));
        return { recipients, envelopes };
      });
      if (found === null) return null;
      await audit.record({
        code: 'vault_envelopes_fetched',
        subjectAccountId: accountId,
        actorAccountId: accountId,
        details: {},
      });
      return {
        recipients: found.recipients.map(({ id, recipient: value, rotatedAt }) => ({
          id,
          recipient: value,
          current: rotatedAt === null,
        })),
        envelopes: found.envelopes.map(({ recipientId, kind, credentialId, ciphertext }) => ({
          recipientId,
          kind: kind === 'recovery' ? 'recovery' : 'passkey_prf',
          credentialId,
          ciphertext: Buffer.from(ciphertext).toString('base64url'),
        })),
      };
    },

    addEnvelope: async (accountId, { credentialId, ciphertext }) => {
      if (!(await allActive(accountId, [credentialId]))) return 'unknown_passkey';
      return asAccount(accountId, async (tx) => {
        const found = await current(tx, accountId);
        if (found === undefined) return 'no_vault' as const;
        await insertEnvelopes(tx, accountId, found.id, [
          { kind: 'passkey_prf', credentialId, ciphertext },
        ]);
        return 'added' as const;
      });
    },

    forgetPasskey: async (accountId, credentialId) => {
      await asAccount(accountId, (tx) =>
        tx
          .delete(envelope)
          .where(
            and(
              eq(envelope.accountId, accountId),
              eq(envelope.kind, 'passkey_prf'),
              eq(envelope.credentialId, credentialId),
            ),
          ),
      );
    },
  };
}
