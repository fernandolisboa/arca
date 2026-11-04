import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  recoveryLinkMinutes,
  type DeviceDescription,
  type PasskeyAttestation,
  type PasskeyCreationOptions,
} from '@arca/api-contract/routes';
import type { Database, Transaction } from '@arca/db';
import { recoveryCode, recoveryLink, recoveryLock } from '@arca/db/enrollment-schema';
import type { I18n } from '@arca/i18n';
import { and, eq, gt, isNotNull, lte, or, sql } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';
import type { EmailMessage, EmailSender } from '../email/email.js';
import type { Notices } from '../email/notices.js';
import type { Logger } from '../logger.js';
import { accountNotice } from './account-notices.js';
import { accounts, devices } from './auth.js';
import type { AccountStatus } from './devices.js';
import { sha256 } from './enrollment.js';
import { passkeyCreation } from './passkey-creation.js';
import { codeCounts, crockfordBase32, recoveryCodeHash } from './recovery-kit.js';

/** Wrong codes in a row that lock recovery for the account (spec 0003, R6). */
export const recoveryAttempts = 5;
const lockHours = 24;
const challengeSeconds = 120;
const codePattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** The code as people type it: any case, with spaces or hyphens, O for 0 and I or L for 1. */
export function normalizeRecoveryCode(typed: string): string {
  return typed.toUpperCase().replace(/[\s-]/g, '').replaceAll('O', '0').replace(/[IL]/g, '1');
}

/** The link's token travels only in the fragment, which never reaches a server (spec 0003, R6). */
export function recoveryMessage(
  i18n: I18n,
  origin: string,
  to: string,
  token: string,
): EmailMessage {
  return {
    to,
    subject: i18n.t('email.recovery.subject'),
    text: [
      i18n.t('email.recovery.body', { minutes: recoveryLinkMinutes }),
      i18n.t('email.recovery.link', { url: `${origin}/recover#${token}` }),
      i18n.t('email.signature'),
    ].join('\n\n'),
  };
}

export type RedeemOutcome =
  | { readonly ok: true; readonly code: string; readonly token: string }
  | { readonly ok: false; readonly reason: 'not_found' | 'invalid_code' | 'locked' };

export type RecoveryRegistration = 'registered' | 'refused' | 'not_found';

export interface Recovery {
  /** The same outcome whether or not the address has an account. */
  readonly start: (email: string) => Promise<'accepted' | 'email_unavailable'>;
  readonly redeem: (token: string, code: string) => Promise<RedeemOutcome>;
  /** Null to a link that is dead or not redeemed. */
  readonly options: (token: string) => Promise<PasskeyCreationOptions | null>;
  readonly verify: (
    token: string,
    response: PasskeyAttestation,
    device: DeviceDescription,
  ) => Promise<RecoveryRegistration>;
}

export interface RecoverySettings {
  /** A database on the app_auth pool. */
  readonly db: Database;
  readonly audit: AuditLog;
  readonly email: EmailSender;
  readonly notices: Notices;
  readonly i18n: I18n;
  readonly origin: string;
  readonly logger: Logger;
  /**
   * False where no email can be sent (spec 0003, R9), behind the closed gate: every start
   * answers so.
   */
  readonly emailAvailable: boolean;
  /** Records the waits that are over first, so a pending recovery passkey is seen as it stands. */
  readonly status: (accountId: string) => Promise<AccountStatus>;
  /** Every start takes at least this long, so its duration says nothing about the address. */
  readonly startFloorMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: (size: number) => Buffer;
}

const live = (tx: Database | Transaction, tokenHash: Buffer) =>
  tx
    .select({
      accountId: recoveryLink.accountId,
      expiresAt: recoveryLink.expiresAt,
      redeemed: isNotNull(recoveryLink.redeemedAt),
    })
    .from(recoveryLink)
    .where(and(eq(recoveryLink.tokenHash, tokenHash), gt(recoveryLink.expiresAt, sql`now()`)))
    .for('update');

export function createRecovery({
  db,
  audit,
  email,
  notices,
  i18n,
  origin,
  logger,
  emailAvailable,
  status,
  startFloorMs = 1500,
  sleep = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
  random = randomBytes,
}: RecoverySettings): Recovery {
  const creation = passkeyCreation({ db, origin });

  const logged = (name: string) => (error: unknown) => {
    logger.error({
      errorName: `${name}:${error instanceof Error ? error.name : 'NonErrorThrown'}`,
    });
  };

  const notify = accountNotice<'recovery_started' | 'recovery_completed' | 'recovery_locked'>({
    db,
    notices,
    logger,
    label: 'RecoveryNotice',
  });

  /**
   * Open when the account has a code that counts, is not locked and no recovery passkey is
   * pending. A page lost after its code was accepted is resumed with a new link and the new code.
   */
  async function open(accountId: string) {
    const [lock] = await db
      .select({ id: recoveryLock.accountId })
      .from(recoveryLock)
      .where(and(eq(recoveryLock.accountId, accountId), gt(recoveryLock.lockedUntil, sql`now()`)));
    if (lock !== undefined) return false;
    const [code] = await db
      .select({ id: recoveryCode.accountId })
      .from(recoveryCode)
      .where(and(eq(recoveryCode.accountId, accountId), codeCounts));
    if (code === undefined) return false;
    return !(await status(accountId)).recoveryPending;
  }

  async function sendLink(address: string) {
    const accountId = await accounts.idOf(db, address);
    if (accountId === undefined || !(await open(accountId))) return;
    const token = random(32).toString('base64url');
    const issued = await db.transaction(async (tx) => {
      // One link per account: a new one replaces the earlier link or open context, and expired
      // links of every account go with it, so the table stays bounded. Only the new code a
      // redeemed context issued redeems the new link; a concurrent start inserts nothing.
      await tx
        .delete(recoveryLink)
        .where(or(eq(recoveryLink.accountId, accountId), lte(recoveryLink.expiresAt, sql`now()`)));
      const inserted = await tx
        .insert(recoveryLink)
        .values({
          tokenHash: sha256(token),
          accountId,
          expiresAt: sql`now() + make_interval(mins => ${recoveryLinkMinutes})`,
        })
        .onConflictDoNothing({ target: recoveryLink.accountId })
        .returning({ expiresAt: recoveryLink.expiresAt });
      const [link] = inserted;
      if (link === undefined) return false;
      // A provisional code resumes a lost page on the new link, so it lasts as long as the link.
      await tx
        .update(recoveryCode)
        .set({ provisionalUntil: link.expiresAt })
        .where(
          and(
            eq(recoveryCode.accountId, accountId),
            isNotNull(recoveryCode.provisionalUntil),
            codeCounts,
          ),
        );
      await audit.record({
        code: 'recovery_started',
        subjectAccountId: accountId,
        actorAccountId: null,
        details: {},
      });
      return true;
    });
    if (!issued) return;
    await email.send(recoveryMessage(i18n, origin, address, token));
    await notify(accountId, 'recovery_started');
  }

  /** One wrong code; the last allowed one locks recovery and ends the link. */
  async function refuse(tx: Transaction, accountId: string, tokenHash: Buffer) {
    const [counted] = await tx
      .update(recoveryLock)
      .set({ failures: sql`${recoveryLock.failures} + 1` })
      .where(eq(recoveryLock.accountId, accountId))
      .returning({ failures: recoveryLock.failures });
    await audit.record({
      code: 'recovery_failed',
      subjectAccountId: accountId,
      actorAccountId: null,
      details: {},
    });
    if ((counted?.failures ?? 0) < recoveryAttempts) return 'invalid_code' as const;
    await tx
      .update(recoveryLock)
      .set({
        failures: 0,
        lockedUntil: sql`now() + make_interval(hours => ${lockHours})`,
      })
      .where(eq(recoveryLock.accountId, accountId));
    await tx.delete(recoveryLink).where(eq(recoveryLink.tokenHash, tokenHash));
    // Someone holding only the inbox can lock a recovery the owner has under way; the new code it
    // issued stops lapsing, or the account would be left with no code at all.
    await tx
      .update(recoveryCode)
      .set({ provisionalUntil: null })
      .where(
        and(
          eq(recoveryCode.accountId, accountId),
          isNotNull(recoveryCode.provisionalUntil),
          codeCounts,
        ),
      );
    return 'locked' as const;
  }

  return {
    start: async (address) => {
      if (!emailAvailable) return 'email_unavailable';
      // Whatever happens, the answer and its timing class are the same for every address.
      await Promise.all([
        sendLink(address.toLowerCase()).catch(logged('RecoveryStart')),
        sleep(startFloorMs),
      ]);
      return 'accepted';
    },

    redeem: async (token, typed) => {
      const tokenHash = sha256(token);
      let accountId: string | undefined;
      const outcome = await db.transaction(async (tx): Promise<RedeemOutcome> => {
        const [link] = await live(tx, tokenHash);
        if (link === undefined || link.redeemed) return { ok: false, reason: 'not_found' };
        accountId = link.accountId;
        // The account's lock row, held to the end, so wrong codes count one at a time.
        await tx.insert(recoveryLock).values({ accountId }).onConflictDoNothing();
        const [lock] = await tx
          .select({ locked: sql<boolean>`${recoveryLock.lockedUntil} > now()` })
          .from(recoveryLock)
          .where(eq(recoveryLock.accountId, accountId))
          .for('update');
        if (lock?.locked === true) return { ok: false, reason: 'locked' };
        // A start that raced the registration of an earlier recovery's passkey opens nothing.
        if (await devices.recoveryPending(tx, accountId)) return { ok: false, reason: 'not_found' };
        const [stored] = await tx
          .select({ salt: recoveryCode.salt, codeHash: recoveryCode.codeHash })
          .from(recoveryCode)
          .where(and(eq(recoveryCode.accountId, accountId), codeCounts));
        const code = normalizeRecoveryCode(typed);
        const matches =
          stored !== undefined &&
          codePattern.test(code) &&
          timingSafeEqual(recoveryCodeHash(stored.salt, code), stored.codeHash);
        if (!matches) {
          return { ok: false, reason: await refuse(tx, accountId, tokenHash) };
        }
        // Spent at once: the new code is issued now, provisional until the passkey registers.
        const issued = crockfordBase32(random(16));
        const salt = random(16);
        const row = {
          salt,
          codeHash: recoveryCodeHash(salt, issued),
          createdAt: sql`now()`,
          confirmedAt: null,
          provisionalUntil: link.expiresAt,
        };
        await tx
          .insert(recoveryCode)
          .values({ accountId, ...row })
          .onConflictDoUpdate({ target: recoveryCode.accountId, set: row });
        // A new token replaces the emailed one, so whoever else reads the inbox cannot finish
        // the recovery this page opened.
        const registration = random(32).toString('base64url');
        await tx
          .update(recoveryLink)
          .set({ tokenHash: sha256(registration), redeemedAt: sql`now()` })
          .where(eq(recoveryLink.tokenHash, tokenHash));
        await tx
          .update(recoveryLock)
          .set({ failures: 0 })
          .where(eq(recoveryLock.accountId, accountId));
        return { ok: true, code: issued, token: registration };
      });
      // Only the code that locks recovery reaches here as locked with the account known: a
      // locked account's link is gone, so later attempts answer not_found.
      if (!outcome.ok && outcome.reason === 'locked' && accountId !== undefined) {
        await notify(accountId, 'recovery_locked');
      }
      return outcome;
    },

    options: async (token) => {
      const tokenHash = sha256(token);
      const value = random(32);
      const [opened] = await db
        .update(recoveryLink)
        .set({
          challenge: value,
          challengeExpiresAt: sql`least(now() + make_interval(secs => ${challengeSeconds}), ${recoveryLink.expiresAt})`,
        })
        .where(
          and(
            eq(recoveryLink.tokenHash, tokenHash),
            gt(recoveryLink.expiresAt, sql`now()`),
            isNotNull(recoveryLink.redeemedAt),
          ),
        )
        .returning({ accountId: recoveryLink.accountId });
      if (opened === undefined) return null;
      return creation.options(opened.accountId, value);
    },

    verify: async (token, response, device) => {
      const tokenHash = sha256(token);
      // The challenge is spent by its first attempt, good or not; the context stays for a retry.
      const issued = await db.transaction(async (tx) => {
        const [found] = await tx
          .select({
            accountId: recoveryLink.accountId,
            challenge: recoveryLink.challenge,
            live: sql<boolean>`${recoveryLink.challengeExpiresAt} > now()`,
          })
          .from(recoveryLink)
          .where(
            and(
              eq(recoveryLink.tokenHash, tokenHash),
              gt(recoveryLink.expiresAt, sql`now()`),
              isNotNull(recoveryLink.redeemedAt),
            ),
          )
          .for('update');
        if (found === undefined) return undefined;
        await tx
          .update(recoveryLink)
          .set({ challenge: null, challengeExpiresAt: null })
          .where(eq(recoveryLink.tokenHash, tokenHash));
        return found;
      });
      if (issued === undefined) return 'not_found';
      if (issued.challenge === null || !issued.live) return 'refused';
      const added = await creation.verify(response, issued.challenge);
      if (added === null) return 'refused';
      const { accountId } = issued;
      const outcome = await db.transaction(async (tx): Promise<RecoveryRegistration> => {
        const [link] = await live(tx, tokenHash);
        if (link === undefined) return 'not_found';
        const stored = await devices.addPending(tx, { accountId, device }, added);
        if (stored === undefined) return 'refused';
        // Single use: the context ends with the passkey it registered.
        await tx.delete(recoveryLink).where(eq(recoveryLink.tokenHash, tokenHash));
        await tx
          .update(recoveryCode)
          .set({ provisionalUntil: null, confirmedAt: sql`now()` })
          .where(eq(recoveryCode.accountId, accountId));
        await audit.record({
          code: 'passkey_added',
          subjectAccountId: accountId,
          actorAccountId: null,
          details: { passkeyId: stored },
        });
        await audit.record({
          code: 'recovery_completed',
          subjectAccountId: accountId,
          actorAccountId: null,
          details: {},
        });
        return 'registered';
      });
      if (outcome === 'registered') await notify(accountId, 'recovery_completed');
      return outcome;
    },
  };
}
