import { createHash, randomBytes } from 'node:crypto';
import type { RecoveryKitStatus } from '@arca/api-contract/routes';
import type { Database } from '@arca/db';
import { recoveryCode } from '@arca/db/enrollment-schema';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';
import type { Notifier } from '../notification/notifier.js';
import type { Logger } from '@arca/telemetry';
import { accountNotice } from './account-notices.js';
import { accounts } from './auth.js';

const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Crockford base32, without the letters people misread (I, L, O, U); 128 bits make 26 symbols. */
export function crockfordBase32(bytes: Uint8Array): string {
  let symbols = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      symbols += crockford.charAt((buffer >> bits) & 31);
    }
    buffer &= (1 << bits) - 1;
  }
  return bits === 0 ? symbols : symbols + crockford.charAt((buffer << (5 - bits)) & 31);
}

/** SHA-256 over the account's 128-bit salt and the code (spec 0003, R6); the code is never stored. */
export const recoveryCodeHash = (salt: Uint8Array, code: string): Buffer =>
  createHash('sha256').update(salt).update(code, 'utf8').digest();

/** A code counts unless a recovery issued it and its link ended before its passkey registered. */
export const codeCounts = or(
  isNull(recoveryCode.provisionalUntil),
  gt(recoveryCode.provisionalUntil, sql`now()`),
);

export interface RecoveryKits {
  readonly status: (accountId: string) => Promise<RecoveryKitStatus['status']>;
  /**
   * The account's first kit, within a day of the account's creation; null when the account
   * already has one or is older, since only a step-up may replace a kit.
   */
  readonly issueFirst: (accountId: string) => Promise<string | null>;
  /** A new kit in place of the old one, whose code stops working; the caller checks the step-up. */
  readonly regenerate: (accountId: string) => Promise<string>;
  /** False when the account has no kit to confirm. */
  readonly confirm: (accountId: string) => Promise<boolean>;
}

export interface RecoveryKitSettings {
  /** A database on the app_auth pool. */
  readonly db: Database;
  readonly audit: AuditLog;
  readonly notifier: Notifier;
  readonly logger: Logger;
  readonly random?: (size: number) => Buffer;
}

export function recoveryKits({
  db,
  audit,
  notifier,
  logger,
  random = randomBytes,
}: RecoveryKitSettings): RecoveryKits {
  const notify = accountNotice<'recovery_kit_regenerated'>({
    notifier,
    logger,
    label: 'RecoveryKitNotice',
  });
  const draw = () => {
    const code = crockfordBase32(random(16));
    const salt = random(16);
    return { code, row: { salt, codeHash: recoveryCodeHash(salt, code) } };
  };
  return {
    status: async (accountId) => {
      const [kit] = await db
        .select({ confirmedAt: recoveryCode.confirmedAt })
        .from(recoveryCode)
        .where(and(eq(recoveryCode.accountId, accountId), codeCounts));
      if (kit === undefined) return 'none';
      return kit.confirmedAt === null ? 'unsaved' : 'saved';
    },
    issueFirst: async (accountId) => {
      const { code, row } = draw();
      if (!(await accounts.createdWithinDay(db, accountId))) return null;
      // Two first kits racing: one is stored, the other caller is asked for a step-up.
      const stored = await db
        .insert(recoveryCode)
        .values({ accountId, ...row })
        .onConflictDoNothing()
        .returning({ accountId: recoveryCode.accountId });
      return stored.length === 1 ? code : null;
    },
    regenerate: async (accountId) => {
      const { code, row } = draw();
      await audit.record({
        code: 'recovery_kit_regenerated',
        subjectAccountId: accountId,
        actorAccountId: accountId,
        details: {},
      });
      await db
        .insert(recoveryCode)
        .values({ accountId, ...row })
        .onConflictDoUpdate({
          target: recoveryCode.accountId,
          set: { ...row, createdAt: sql`now()`, confirmedAt: null, provisionalUntil: null },
        });
      await notify(accountId, 'recovery_kit_regenerated');
      return code;
    },
    confirm: async (accountId) => {
      const [kit] = await db
        .update(recoveryCode)
        .set({ confirmedAt: sql`coalesce(${recoveryCode.confirmedAt}, now())` })
        .where(and(eq(recoveryCode.accountId, accountId), codeCounts))
        .returning({ accountId: recoveryCode.accountId });
      return kit !== undefined;
    },
  };
}
