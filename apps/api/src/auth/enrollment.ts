import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { EnrollOwnerRequest } from '@arca/api-contract/routes';
import type { Database } from '@arca/db';
import { registrationContext, setup } from '@arca/db/enrollment-schema';
import type { I18n } from '@arca/i18n';
import { eq, lte, or, sql } from 'drizzle-orm';
import { accounts } from './auth.js';
import { EmailNotConfiguredError, type EmailMessage, type EmailSender } from '../email/email.js';

export const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

/** The hash of an owner enrollment code when it is the configured one, else null. */
export type OwnerCode = (code: string | undefined) => Buffer | null;

/** Compared over SHA-256 hashes in constant time (spec 0003, R2); null configures no code. */
export function ownerCode(configuredHex: string | null): OwnerCode {
  const configured = configuredHex === null ? null : Buffer.from(configuredHex, 'hex');
  return (code) => {
    if (configured === null || code === undefined) return null;
    const hash = sha256(code);
    return timingSafeEqual(hash, configured) ? hash : null;
  };
}

/** The link's token travels only in the fragment, which never reaches a server (spec 0003, R2). */
export function enrollmentMessage(
  i18n: I18n,
  origin: string,
  to: string,
  token: string,
): EmailMessage {
  return {
    to,
    subject: i18n.t('email.enrollment.subject'),
    text: [
      i18n.t('email.enrollment.body'),
      i18n.t('email.enrollment.link', { url: `${origin}/enroll#${token}` }),
      i18n.t('email.signature'),
    ].join('\n\n'),
  };
}

export type EnrollOwnerOutcome = 'sent' | 'not_found' | 'email_unavailable';

export interface Enrollment {
  readonly enrollOwner: (request: EnrollOwnerRequest) => Promise<EnrollOwnerOutcome>;
}

export interface EnrollmentSettings {
  /** A database on the app_auth pool. */
  readonly db: Database;
  readonly email: EmailSender;
  readonly i18n: I18n;
  readonly origin: string;
  readonly ownerCode: OwnerCode;
  readonly random?: (size: number) => Buffer;
}

export function createEnrollment({
  db,
  email,
  i18n,
  origin,
  ownerCode: matching,
  random = randomBytes,
}: EnrollmentSettings): Enrollment {
  return {
    /**
     * Only while no account exists and the configured code was never spent; a new context
     * replaces any earlier owner context, and expired contexts are swept on the way.
     */
    enrollOwner: async ({ code, email: address }) => {
      const codeHash = matching(code);
      if (codeHash === null) return 'not_found';
      const token = random(32).toString('base64url');
      const to = address.toLowerCase();
      const issued = await db.transaction(async (tx) => {
        const [spent] = await tx
          .select({ usedAt: setup.usedAt })
          .from(setup)
          .where(eq(setup.codeHash, codeHash));
        if (spent !== undefined || (await accounts.anyExists(tx))) return false;
        await tx
          .delete(registrationContext)
          .where(
            or(
              eq(registrationContext.kind, 'owner'),
              lte(registrationContext.expiresAt, sql`now()`),
            ),
          );
        await tx
          .insert(registrationContext)
          .values({ tokenHash: sha256(token), kind: 'owner', email: to });
        return true;
      });
      if (!issued) return 'not_found';
      try {
        await email.send(enrollmentMessage(i18n, origin, to, token));
      } catch (error) {
        // No way to send, behind the closed gate (spec 0003, R9); the address is not kept.
        if (!(error instanceof EmailNotConfiguredError)) throw error;
        await db
          .delete(registrationContext)
          .where(eq(registrationContext.tokenHash, sha256(token)));
        return 'email_unavailable';
      }
      return 'sent';
    },
  };
}
