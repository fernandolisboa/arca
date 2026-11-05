import { randomBytes } from 'node:crypto';
import {
  inviteLifetimeHours,
  maxOpenInvites,
  type Invite,
  type InviteDetails,
} from '@arca/api-contract/routes';
import type { Database, Transaction } from '@arca/db';
import { invite } from '@arca/db/enrollment-schema';
import type { I18n } from '@arca/i18n';
import { and, count, desc, eq, gt, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { markForRetentionErasure } from '../account/deletion.js';
import type { AuditLog } from '../audit/log.js';
import { EmailNotConfiguredError, type EmailMessage, type EmailSender } from '../email/email.js';
import type { Notifier } from '../notification/notifier.js';
import type { Logger } from '@arca/telemetry';
import { accounts } from './auth.js';
import { sha256 } from './enrollment.js';

/** The link's token travels only in the fragment; the email never names the inviter (spec 0003, R8). */
export function inviteMessage(i18n: I18n, origin: string, to: string, token: string): EmailMessage {
  return {
    to,
    subject: i18n.t('email.invite.subject'),
    text: [
      i18n.t('email.invite.body', { hours: inviteLifetimeHours }),
      i18n.t('email.invite.link', { url: `${origin}/invite#${token}` }),
      i18n.t('email.signature'),
    ].join('\n\n'),
  };
}

export type CreateInviteOutcome = 'sent' | 'unconfirmed' | 'too_many' | 'email_unavailable';

export interface Invites {
  /** Only a confirmed account invites (spec 0003, R2). */
  readonly create: (inviterId: string, email: string) => Promise<CreateInviteOutcome>;
  readonly list: (inviterId: string) => Promise<readonly Invite[]>;
  /** Who sent a link that can still be accepted. */
  readonly details: (token: string) => Promise<InviteDetails | undefined>;
  /** False unless the invite is the inviter's and its account waits for a decision. */
  readonly confirm: (inviterId: string, inviteId: string) => Promise<boolean>;
  readonly decline: (inviterId: string, inviteId: string) => Promise<boolean>;
  /** Tells the inviter, once the registration that accepted the invite has committed. */
  readonly accepted: (inviteId: string) => Promise<void>;
}

export interface InviteSettings {
  /** A database on the app_auth pool. */
  readonly db: Database;
  readonly audit: AuditLog;
  readonly email: EmailSender;
  readonly notifier: Notifier;
  readonly i18n: I18n;
  readonly origin: string;
  readonly logger: Logger;
  /** Starts `eraseAccount` for a declined account (spec 0004, R9). */
  readonly startErasure: (accountId: string) => Promise<unknown>;
  /** Links the inviter and the confirmed account, before the confirmation commits (spec 0005, R4). */
  readonly linkAccounts: (inviterId: string, inviteeId: string) => Promise<void>;
  readonly random?: (size: number) => Buffer;
}

/** An invite that can still be accepted; registration narrows it to one token and invite. */
export const liveInvite = (tokenHash?: Buffer, inviteId?: string) =>
  and(
    inviteId === undefined ? undefined : eq(invite.id, inviteId),
    tokenHash === undefined ? undefined : eq(invite.tokenHash, tokenHash),
    isNull(invite.acceptedAt),
    gt(invite.expiresAt, sql`now()`),
  );

const open = liveInvite();

/**
 * Invites never accepted that have expired by `now` go, each with its `invite expired` event; the
 * daily cleanup passes its own clock (spec 0004, R10).
 */
export async function sweepExpiredInvites(
  tx: Transaction,
  audit: AuditLog,
  now: Date | SQL = sql`now()`,
) {
  const expired = await tx
    .delete(invite)
    .where(and(isNull(invite.acceptedAt), lte(invite.expiresAt, now)))
    .returning({ id: invite.id, inviterId: invite.inviterId });
  for (const { id, inviterId } of expired) {
    await audit.record({
      code: 'invite_expired',
      subjectAccountId: inviterId,
      actorAccountId: null,
      details: { inviteId: id },
    });
  }
}

/** The inviter's accepted invite whose account waits for a decision, locked for it. */
async function awaitingDecision(tx: Transaction, inviterId: string, inviteId: string) {
  const [found] = await tx
    .select({ accountId: invite.acceptedAccountId })
    .from(invite)
    .where(
      and(eq(invite.id, inviteId), eq(invite.inviterId, inviterId), isNotNull(invite.acceptedAt)),
    )
    .for('update');
  return found?.accountId ?? undefined;
}

export function createInvites({
  db,
  audit,
  email,
  notifier,
  i18n,
  origin,
  logger,
  startErasure,
  linkAccounts,
  random = randomBytes,
}: InviteSettings): Invites {
  return {
    create: async (inviterId, address) => {
      const to = address.toLowerCase();
      const token = random(32).toString('base64url');
      const outcome = await db.transaction(async (tx) => {
        // Concurrent invites from one account wait here, so the cap holds.
        if (!(await accounts.lock(tx, inviterId))) return 'unconfirmed';
        if (!(await accounts.isConfirmed(tx, inviterId))) return 'unconfirmed';
        await sweepExpiredInvites(tx, audit);
        // A new invite to the same address replaces the open one.
        await tx
          .delete(invite)
          .where(and(eq(invite.inviterId, inviterId), eq(invite.email, to), open));
        const [opened] = await tx
          .select({ total: count() })
          .from(invite)
          .where(and(eq(invite.inviterId, inviterId), open));
        if ((opened?.total ?? 0) >= maxOpenInvites) return 'too_many';
        const [created] = await tx
          .insert(invite)
          .values({ inviterId, email: to, tokenHash: sha256(token) })
          .returning({ id: invite.id });
        if (created === undefined) throw new Error('the invite was not stored');
        await audit.record({
          code: 'invite_created',
          subjectAccountId: inviterId,
          actorAccountId: inviterId,
          details: { inviteId: created.id },
        });
        return 'stored';
      });
      if (outcome !== 'stored') return outcome;
      try {
        await email.send(inviteMessage(i18n, origin, to, token));
      } catch (error) {
        // An invite that never left takes no open slot and keeps no address. Without a way to
        // send, the closed gate answers first (spec 0003, R9).
        await db.delete(invite).where(eq(invite.tokenHash, sha256(token)));
        if (!(error instanceof EmailNotConfiguredError)) throw error;
        return 'email_unavailable';
      }
      return 'sent';
    },

    list: async (inviterId) => {
      const rows = await db
        .select({
          id: invite.id,
          email: invite.email,
          createdAt: invite.createdAt,
          expiresAt: invite.expiresAt,
          acceptedAccountId: invite.acceptedAccountId,
        })
        .from(invite)
        .where(
          and(
            eq(invite.inviterId, inviterId),
            or(isNotNull(invite.acceptedAt), gt(invite.expiresAt, sql`now()`)),
          ),
        )
        .orderBy(desc(invite.createdAt));
      const confirmed = await accounts.confirmedAmong(
        db,
        rows.flatMap(({ acceptedAccountId }) => acceptedAccountId ?? []),
      );
      return rows.map(({ acceptedAccountId, createdAt, expiresAt, ...row }) => ({
        ...row,
        status:
          acceptedAccountId === null
            ? 'open'
            : confirmed.has(acceptedAccountId)
              ? 'confirmed'
              : 'accepted',
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      }));
    },

    details: async (token) => {
      const [found] = await db
        .select({ inviterId: invite.inviterId, email: invite.email })
        .from(invite)
        .where(liveInvite(sha256(token)));
      // Like registration, a link to an address that already has an account opens nothing.
      if (found === undefined || (await accounts.withEmail(db, found.email))) return undefined;
      const inviterEmail = await accounts.emailOf(db, found.inviterId);
      return inviterEmail === undefined ? undefined : { inviterEmail };
    },

    confirm: (inviterId, inviteId) =>
      db.transaction(async (tx) => {
        const accountId = await awaitingDecision(tx, inviterId, inviteId);
        if (accountId === undefined || !(await accounts.confirm(tx, accountId))) return false;
        // A failure here rolls the confirmation back; the link is kept, and a retry adds nothing.
        await linkAccounts(inviterId, accountId);
        await audit.record({
          code: 'invite_confirmed',
          subjectAccountId: inviterId,
          actorAccountId: inviterId,
          details: { inviteId },
        });
        return true;
      }),

    // The account is due for erasure at once and loses its sessions; the invite goes now, so the
    // decision is final, and `eraseAccount` frees the address (spec 0004, R10).
    decline: async (inviterId, inviteId) => {
      const declined = await db.transaction(async (tx) => {
        const accountId = await awaitingDecision(tx, inviterId, inviteId);
        if (accountId === undefined) return undefined;
        const marked = await markForRetentionErasure(tx, audit, {
          accountId,
          reason: 'invite_declined',
          dueAt: 'now',
          cutoff: new Date(),
          actorAccountId: inviterId,
        });
        // An unconfirmed account the daily job already marked is erased anyway; the decision
        // still stands.
        const alreadyMarked =
          !marked &&
          !(await accounts.isConfirmed(tx, accountId)) &&
          (await accounts.deletionDueAt(tx, accountId)) !== null;
        if (!marked && !alreadyMarked) return undefined;
        await tx.delete(invite).where(eq(invite.id, inviteId));
        await audit.record({
          code: 'invite_declined',
          subjectAccountId: inviterId,
          actorAccountId: inviterId,
          details: { inviteId },
        });
        return accountId;
      });
      if (declined === undefined) return false;
      // A run that fails to start waits for the daily erasure, which finds the account due.
      try {
        await startErasure(declined);
      } catch (error) {
        logger.error({
          errorName: `DeclinedErasure:${error instanceof Error ? error.name : 'NonErrorThrown'}`,
        });
      }
      return true;
    },

    // A notice that fails to send never undoes the registration; the failure is logged.
    accepted: async (inviteId) => {
      try {
        const [found] = await db
          .select({ inviterId: invite.inviterId })
          .from(invite)
          .where(eq(invite.id, inviteId));
        if (found !== undefined) {
          await notifier.notify(found.inviterId, { kind: 'invite_accepted' });
        }
      } catch (error) {
        logger.error({
          errorName: `InviteAcceptedNotice:${error instanceof Error ? error.name : 'NonErrorThrown'}`,
        });
      }
    },
  };
}
