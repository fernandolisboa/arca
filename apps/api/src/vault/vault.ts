import type {
  AuditEventCode,
  PasskeyEnvelope,
  ResealVaultRecoveryRequest,
  RotateVaultIdentityRequest,
  SetUpVaultRequest,
  VaultEnvelopesResponse,
  VaultStatusResponse,
} from '@arca/api-contract/routes';
import { withIdentity, type Database, type Transaction } from '@arca/db';
import { event } from '@arca/db/audit-schema';
import { envelope, recipient, sharingState } from '@arca/db/vault-schema';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';

export type VaultSetUp = 'created' | 'exists' | 'unknown_passkey';
export type EnvelopeAdded = 'added' | 'no_vault' | 'unknown_passkey';
export type VaultRotation = 'rotated' | 'no_vault' | 'changed' | 'unknown_passkey';
export type RecoveryResealed = 'resealed' | 'no_vault' | 'changed';

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
  /**
   * Marks the named recipient rotated, if it is still current, and makes the new one current with
   * its envelopes, in one transaction; the old recipient's envelopes stay until the cleanup
   * (ADR-0018). A device that missed another rotation gets `changed`, never rotates the newer one.
   */
  readonly rotate: (
    accountId: string,
    request: RotateVaultIdentityRequest,
  ) => Promise<VaultRotation>;
  /**
   * Replaces every recovery envelope, or none: the list must name exactly the recipients that
   * have one, so no envelope is left sealed to the old secret (spec 0003, R6).
   */
  readonly resealRecovery: (
    accountId: string,
    request: ResealVaultRecoveryRequest,
  ) => Promise<RecoveryResealed>;
  /**
   * Deletes the recipients, their envelopes and the sharing state, for a vault whose secret was
   * lost before anything was stored in it. Refusing it while the account owns documents comes
   * with the documents table (R4). False when there was nothing to delete.
   */
  readonly reset: (accountId: string) => Promise<boolean>;
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

const isRecipientOf = (accountId: string) => eq(recipient.accountId, accountId);

const anyRecipient = (tx: Transaction, accountId: string) =>
  tx
    .select({ id: recipient.id })
    .from(recipient)
    .where(isRecipientOf(accountId))
    .limit(1)
    .then(([found]) => found);

/**
 * The events that change whether the vault recovery secret is still the kit's: a recovery that
 * activated a passkey, or a new kit, makes it due; sealing it, or a cancelled recovery, settles it.
 */
const secretDueAfter: readonly AuditEventCode[] = [
  'recovery_completed',
  'recovery_kit_regenerated',
];
const secretSettledBy: readonly AuditEventCode[] = [
  'recovery_cancelled',
  'vault_created',
  'vault_recovery_resealed',
];

/** Read from the account's own audit trail, which row-level security lets app_api read. */
const resealDue = async (tx: Transaction, accountId: string) => {
  const [latest] = await tx
    .select({ code: event.code })
    .from(event)
    .where(
      and(
        eq(event.subjectAccountId, accountId),
        inArray(event.code, [...secretDueAfter, ...secretSettledBy]),
      ),
    )
    .orderBy(desc(event.time), desc(event.id))
    .limit(1);
  return secretDueAfter.some((code) => code === latest?.code);
};

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

  const record = (accountId: string, code: AuditEventCode & `vault_${string}`) =>
    audit.record({ code, subjectAccountId: accountId, actorAccountId: accountId, details: {} });

  /** The new identity's recovery envelope and passkey envelopes, for its recipient. */
  const storeIdentity = (
    tx: Transaction,
    accountId: string,
    recipientId: string,
    { passkeyEnvelopes, recoveryEnvelope }: SetUpVaultRequest,
  ) =>
    insertEnvelopes(tx, accountId, recipientId, [
      { kind: 'recovery', credentialId: null, ciphertext: recoveryEnvelope },
      ...passkeyEnvelopes.map(({ credentialId, ciphertext }) => ({
        kind: 'passkey_prf' as const,
        credentialId,
        ciphertext,
      })),
    ]);

  const passkeysActive = (accountId: string, { passkeyEnvelopes }: SetUpVaultRequest) =>
    allActive(
      accountId,
      passkeyEnvelopes.map(({ credentialId }) => credentialId),
    );

  return {
    status: (accountId) =>
      asAccount(accountId, async (tx) => {
        const found = await current(tx, accountId);
        if (found === undefined) return { recipient: null, resealDue: false };
        return { recipient: found.recipient, resealDue: await resealDue(tx, accountId) };
      }),

    setUp: async (accountId, request) => {
      if (!(await passkeysActive(accountId, request))) return 'unknown_passkey';
      // A current recipient already there, or one a concurrent set-up stored first, conflicts
      // with the one-current-recipient index, so nothing is stored.
      const outcome = await asAccount(accountId, async (tx) => {
        const recipientId = await insertRecipient(tx, accountId, request.recipient);
        if (recipientId === undefined) return 'exists' as const;
        await storeIdentity(tx, accountId, recipientId, request);
        return 'created' as const;
      });
      if (outcome === 'created') await record(accountId, 'vault_created');
      return outcome;
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
          .where(isRecipientOf(accountId))
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
      await record(accountId, 'vault_envelopes_fetched');
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

    rotate: async (accountId, request) => {
      if (!(await passkeysActive(accountId, request))) return 'unknown_passkey';
      // Recorded before the commit, like every security event: a failed write keeps the old state.
      return asAccount(accountId, async (tx) => {
        // The update locks the row, so a concurrent rotation of the same recipient waits, then
        // finds it rotated and answers `changed`.
        const rotated = await tx.execute<{ id: string }>(sql`
          UPDATE vault.recipient SET rotated_at = now()
           WHERE id = ${request.from} AND account_id = ${accountId} AND rotated_at IS NULL
          RETURNING id`);
        if (rotated.rows.length === 0) {
          return (await anyRecipient(tx, accountId)) === undefined
            ? ('no_vault' as const)
            : ('changed' as const);
        }
        const recipientId = await insertRecipient(tx, accountId, request.recipient);
        if (recipientId === undefined) throw new Error('the rotated recipient is still current');
        await storeIdentity(tx, accountId, recipientId, request);
        await record(accountId, 'vault_identity_rotated');
        return 'rotated' as const;
      });
    },

    resealRecovery: async (accountId, { envelopes: resealed }) =>
      asAccount(accountId, async (tx) => {
        // The recipients are locked first, so a rotation adding one with its own recovery
        // envelope either commits before this reads (and the list no longer matches) or waits.
        await tx
          .select({ id: recipient.id })
          .from(recipient)
          .where(isRecipientOf(accountId))
          .for('update');
        const kept = await tx
          .select({ recipientId: envelope.recipientId })
          .from(envelope)
          .where(and(eq(envelope.accountId, accountId), eq(envelope.kind, 'recovery')))
          .for('update');
        if (kept.length === 0) return 'no_vault' as const;
        const named = new Set(resealed.map(({ recipientId }) => recipientId));
        if (
          kept.length !== named.size ||
          !kept.every(({ recipientId }) => named.has(recipientId))
        ) {
          return 'changed' as const;
        }
        for (const { recipientId, ciphertext } of resealed) {
          await tx.execute(sql`
            UPDATE vault.envelope SET ciphertext = ${bytes(ciphertext)}
             WHERE account_id = ${accountId} AND recipient_id = ${recipientId}
               AND kind = 'recovery'`);
        }
        await record(accountId, 'vault_recovery_resealed');
        return 'resealed' as const;
      }),

    reset: (accountId) =>
      asAccount(accountId, async (tx) => {
        const recipients = await tx
          .delete(recipient)
          .where(isRecipientOf(accountId))
          .returning({ id: recipient.id });
        await tx.delete(sharingState).where(eq(sharingState.accountId, accountId));
        if (recipients.length === 0) return false;
        await record(accountId, 'vault_reset');
        return true;
      }),
  };
}
