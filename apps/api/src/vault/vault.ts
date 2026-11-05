import type {
  AccountLink,
  AuditEventCode,
  PasskeyEnvelope,
  ResealVaultRecoveryRequest,
  RotateVaultIdentityRequest,
  SetUpVaultRequest,
  SharingStateChange,
  StoreSharingStateRequest,
  StoredSharingState,
  VaultEnvelopesResponse,
  VaultStatusResponse,
} from '@arca/api-contract/routes';
import { withIdentity, type Database, type Transaction } from '@arca/db';
import { link } from '@arca/db/account-schema';
import { document, envelope, recipient, sharingState } from '@arca/db/vault-schema';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuditLog } from '../audit/log.js';

export type VaultSetUp = 'created' | 'exists' | 'unknown_passkey';
export type EnvelopeAdded = 'added' | 'no_vault' | 'unknown_passkey';
export type VaultRotation =
  'rotated' | 'no_vault' | 'changed' | 'sharing_state_changed' | 'unknown_passkey';
export type RecoveryResealed = 'resealed' | 'no_vault' | 'changed';
export type SharingStateStored = 'stored' | 'no_vault' | 'vault_changed' | 'changed';

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
   * lost before anything was stored in it: refused while the account owns a document, which only
   * the lost identity opens.
   */
  readonly reset: (accountId: string) => Promise<VaultReset>;
  /** The sharing state as the account's device last stored it; null before the first. */
  readonly sharingState: (accountId: string) => Promise<StoredSharingState | null>;
  /**
   * Stores a newly tagged state over the version the device read, for the identity still current:
   * `vault_changed` when a rotation or reset came first, `changed` when another state did.
   */
  readonly storeSharingState: (
    accountId: string,
    request: StoreSharingStateRequest,
  ) => Promise<SharingStateStored>;
  /**
   * The accounts linked to this one, with their email and current recipient, by email; here
   * because the recipients are the vault's, though the route sits with the account's.
   */
  readonly links: (accountId: string) => Promise<AccountLink[]>;
}

export type VaultReset = 'reset' | 'no_vault' | 'has_documents';

export interface VaultSettings {
  /** A database on the app_api pool. */
  readonly db: Database;
  /** The credential IDs of the account's active passkeys, read on the app_auth pool. */
  readonly activeCredentials: (accountId: string) => Promise<readonly string[]>;
  /** The email of each of these accounts that still exists, read on the app_auth pool. */
  readonly emailsOf: (accountIds: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  readonly audit: AuditLog;
}

const bytes = (base64url: string) => Buffer.from(base64url, 'base64url');
const base64url = (value: Uint8Array) => Buffer.from(value).toString('base64url');

/**
 * The pins of a stored state, read only to audit a changed one: the device alone verifies a
 * state and decides encryption from it, so anything unreadable here has no pins.
 */
const pinsOf = (state: Uint8Array | undefined): Readonly<Record<string, string>> => {
  if (state === undefined) return {};
  try {
    const parsed = StatePins.safeParse(JSON.parse(Buffer.from(state).toString('utf8')));
    return parsed.success ? parsed.data.pins : {};
  } catch {
    return {};
  }
};
const StatePins = z.object({
  pins: z.record(z.uuid(), z.string().regex(/^age1pq1[02-9ac-hj-np-z]+$/)),
});

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
 * Whether the vault recovery secret is no longer the kit's (spec 0003, R6): a new kit, or a
 * recovery that was not cancelled, came after the secret was last sealed. Read from the account's
 * own audit trail, which row-level security lets app_api read.
 */
const resealDue = async (tx: Transaction, accountId: string) => {
  const codes: readonly AuditEventCode[] = [
    'recovery_kit_regenerated',
    'recovery_completed',
    'recovery_cancelled',
    'vault_created',
    'vault_recovery_resealed',
  ];
  const latest = (...of: readonly AuditEventCode[]) =>
    sql`max(time) FILTER (WHERE code IN (${sql.join(
      of.map((code) => sql`${code}`),
      sql`, `,
    )}))`;
  const [row] = (
    await tx.execute<{ due: boolean }>(sql`
      WITH latest AS (
        SELECT ${latest('recovery_kit_regenerated')} AS kit,
               ${latest('recovery_completed')} AS recovered,
               ${latest('recovery_cancelled')} AS cancelled,
               coalesce(${latest('vault_created', 'vault_recovery_resealed')}, '-infinity') AS sealed
          FROM audit.event
         WHERE subject_account_id = ${accountId}
           AND code IN (${sql.join(
             codes.map((code) => sql`${code}`),
             sql`, `,
           )}))
      SELECT coalesce(kit > sealed, false)
          OR coalesce(recovered > sealed AND recovered > coalesce(cancelled, '-infinity'), false)
          AS due
        FROM latest`)
  ).rows;
  return row?.due === true;
};

const current = (tx: Transaction, accountId: string) =>
  tx
    .select({ id: recipient.id, recipient: recipient.recipient })
    .from(recipient)
    .where(and(eq(recipient.accountId, accountId), isNull(recipient.rotatedAt)))
    .then(([found]) => found);

/** The accounts linked to this one, in either direction. */
async function linkedAccounts(tx: Transaction, accountId: string): Promise<string[]> {
  const rows = await tx
    .select({ inviterId: link.inviterId, inviteeId: link.inviteeId })
    .from(link)
    .where(or(eq(link.inviterId, accountId), eq(link.inviteeId, accountId)));
  return [
    ...new Set(rows.map((row) => (row.inviterId === accountId ? row.inviteeId : row.inviterId))),
  ];
}

const storedVersion = async (tx: Transaction, accountId: string) =>
  (
    await tx
      .select({ version: sharingState.version })
      .from(sharingState)
      .where(eq(sharingState.accountId, accountId))
  )[0]?.version;

/** Rolls a rotation back when it would leave the stored sharing state under the old key. */
class SharingStateConflict extends Error {
  override name = 'SharingStateConflict';
}

export function createVault({ db, activeCredentials, emailsOf, audit }: VaultSettings): Vault {
  /**
   * Stores a state over the version it replaces, the caller holding the current recipient's row
   * lock first. A linked account's changed pin is audited; nothing else is, so a state cannot
   * make one request write an audit event per invented pin.
   */
  const writeSharingState = async (
    tx: Transaction,
    accountId: string,
    { expectedVersion, sharingState: { version, state, tag } }: SharingStateChange,
  ): Promise<'stored' | 'changed'> => {
    let previous: Uint8Array | undefined;
    if (expectedVersion === null) {
      const inserted = await tx.execute<{ account_id: string }>(sql`
        INSERT INTO vault.sharing_state (account_id, version, state, tag)
        VALUES (${accountId}, ${version}, ${bytes(state)}, ${bytes(tag)})
        ON CONFLICT DO NOTHING RETURNING account_id`);
      if (inserted.rows.length === 0) return 'changed';
    } else {
      const [found] = await tx
        .select({ state: sharingState.state })
        .from(sharingState)
        .where(
          and(eq(sharingState.accountId, accountId), eq(sharingState.version, expectedVersion)),
        )
        .for('update');
      if (found === undefined) return 'changed';
      previous = found.state;
      await tx.execute(sql`
        UPDATE vault.sharing_state
           SET version = ${version}, state = ${bytes(state)}, tag = ${bytes(tag)}, updated_at = now()
         WHERE account_id = ${accountId}`);
    }
    const before = pinsOf(previous);
    const after = pinsOf(bytes(state));
    for (const pinned of (await linkedAccounts(tx, accountId)).sort()) {
      if (
        Object.hasOwn(before, pinned) &&
        Object.hasOwn(after, pinned) &&
        before[pinned] !== after[pinned]
      ) {
        await audit.record({
          code: 'recipient_pin_changed',
          subjectAccountId: accountId,
          actorAccountId: accountId,
          details: { accountId: pinned },
        });
      }
    }
    return 'stored';
  };

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
        // No device could verify a state left under the old share key, so the rotation stores
        // its re-tagged state over the stored version, or finds none stored.
        const retagged =
          request.sharingState === null
            ? (await storedVersion(tx, accountId)) === undefined
            : (await writeSharingState(tx, accountId, request.sharingState)) === 'stored';
        if (!retagged) throw new SharingStateConflict();
        const recipientId = await insertRecipient(tx, accountId, request.recipient);
        if (recipientId === undefined) throw new Error('the rotated recipient is still current');
        await storeIdentity(tx, accountId, recipientId, request);
        await record(accountId, 'vault_identity_rotated');
        return 'rotated' as const;
      }).catch((error: unknown) => {
        if (error instanceof SharingStateConflict) return 'sharing_state_changed' as const;
        throw error;
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
        // Locked first: a document created meanwhile then commits before the check below sees it.
        await tx
          .select({ id: recipient.id })
          .from(recipient)
          .where(isRecipientOf(accountId))
          .for('update');
        const owned = await tx
          .select({ id: document.id })
          .from(document)
          .where(eq(document.ownerId, accountId))
          .limit(1);
        if (owned.length > 0) return 'has_documents';
        const recipients = await tx
          .delete(recipient)
          .where(isRecipientOf(accountId))
          .returning({ id: recipient.id });
        await tx.delete(sharingState).where(eq(sharingState.accountId, accountId));
        if (recipients.length === 0) return 'no_vault';
        await record(accountId, 'vault_reset');
        return 'reset';
      }),

    sharingState: (accountId) =>
      asAccount(accountId, async (tx) => {
        const [found] = await tx
          .select({
            version: sharingState.version,
            state: sharingState.state,
            tag: sharingState.tag,
          })
          .from(sharingState)
          .where(eq(sharingState.accountId, accountId));
        if (found === undefined) return null;
        return { version: found.version, state: base64url(found.state), tag: base64url(found.tag) };
      }),

    storeSharingState: (accountId, { recipient: tagger, expectedVersion, sharingState: stored }) =>
      asAccount(accountId, async (tx) => {
        // Shared with the lock a rotation's update and a reset take, so neither runs beside this:
        // the state is stored only for the identity still current, whose share key tagged it.
        const [held] = await tx
          .select({ recipient: recipient.recipient })
          .from(recipient)
          .where(and(eq(recipient.accountId, accountId), isNull(recipient.rotatedAt)))
          .for('share');
        if (held === undefined) {
          return (await anyRecipient(tx, accountId)) === undefined
            ? ('no_vault' as const)
            : ('vault_changed' as const);
        }
        if (held.recipient !== tagger) return 'vault_changed' as const;
        return writeSharingState(tx, accountId, { expectedVersion, sharingState: stored });
      }),

    links: async (accountId) => {
      const found = await asAccount(accountId, async (tx) => {
        const linked = await linkedAccounts(tx, accountId);
        if (linked.length === 0) return [];
        const current = await tx
          .select({ accountId: recipient.accountId, recipient: recipient.recipient })
          .from(recipient)
          .where(and(inArray(recipient.accountId, linked), isNull(recipient.rotatedAt)));
        const recipients = new Map(current.map((row) => [row.accountId, row.recipient]));
        return linked.map((id) => ({ accountId: id, recipient: recipients.get(id) ?? null }));
      });
      const emails = await emailsOf(found.map((row) => row.accountId));
      return found
        .flatMap((row) => {
          const email = emails.get(row.accountId);
          return email === undefined ? [] : [{ ...row, email }];
        })
        .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
    },
  };
}
