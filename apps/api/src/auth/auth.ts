import { passkey } from '@better-auth/passkey';
import {
  authSchema,
  passkey as passkeyTable,
  session as sessionTable,
  user,
  verification as verificationTable,
} from '@arca/db/auth-schema';
import type { Database } from '@arca/db';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { eq, lte, sql } from 'drizzle-orm';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { authBasePath, DeviceDescription } from '@arca/api-contract/routes';
import type { AuditLog } from '../audit/log.js';
import type { Notices } from '../email/notices.js';
import type { Logger } from '../logger.js';
import { describeDevice } from './device.js';
import { signInFailedLog } from './limits.js';
import type { RateLimiter } from './rate-limit.js';
import { noticeNewSignIn } from './sign-in-notice.js';

export interface AuthSettings {
  /** A database on the app_auth pool; no other role may read the auth schema. */
  readonly db: Database;
  readonly secret: string;
  /** The environment's own origin, the only one trusted (spec 0003, R4 and R9). */
  readonly origin: string;
  readonly logger: Logger;
  /** Every sign-in is recorded (spec 0003, R7). */
  readonly audit: AuditLog;
  /** Security notices by email, such as a sign-in from a new browser (spec 0003, R7). */
  readonly notices: Notices;
  /** Spaces out the failed sign-in events of one credential (spec 0003, R7 and R10). */
  readonly limiter: RateLimiter;
}

const daySeconds = 24 * 60 * 60;
const signInPath = '/passkey/verify-authentication';
const signInOptionsPath = '/passkey/generate-authenticate-options';

/** The credential ID a sign-in's assertion names, if any. */
function assertedCredential(body: unknown) {
  const { response } = (body ?? {}) as { response?: { id?: unknown } };
  return typeof response?.id === 'string' && response.id !== '' ? response.id : undefined;
}

/** The credential ID of the assertion a sign-in verified; undefined on any other path. */
function signingCredential(context: { path?: string; body?: unknown } | null | undefined) {
  return context?.path === signInPath ? assertedCredential(context.body) : undefined;
}

/** The authenticator's UV flag; the passkey plugin itself never requires it (spec 0003, R3). */
function requireUserVerified(userVerified: boolean | undefined): void {
  if (userVerified !== true) throw new APIError('UNAUTHORIZED', { code: 'USER_NOT_VERIFIED' });
}

/**
 * Better Auth with the passkey plugin (spec 0003, R1). Only passkeys sign in: email and password,
 * magic links, social and anonymous sign-in are never configured, and the router in front of it
 * lets through only the allow-listed endpoints. Telemetry is off.
 */
export function createAuth({ db, secret, origin, logger, audit, notices, limiter }: AuthSettings) {
  return betterAuth({
    appName: 'Arca',
    baseURL: origin,
    basePath: authBasePath,
    secret,
    trustedOrigins: [origin],
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    telemetry: { enabled: false },
    // Better Auth's messages and arguments can carry addresses or request details, so only the
    // level reaches the log (spec 0001, R3).
    logger: {
      level: 'warn',
      log: (level) => {
        if (level === 'error') logger.error({ errorName: 'BetterAuthError' });
        else logger.info({ errorName: 'BetterAuthWarning' });
      },
    },
    emailAndPassword: { enabled: false },
    user: {
      changeEmail: { enabled: false },
      additionalFields: {
        lastSignInAt: { type: 'date', required: false, input: false },
      },
    },
    // A 3-day idle timeout, slid at most daily by GET /v1/session; the 30-day absolute lifetime
    // is checked on the session's creation time (spec 0003, R4).
    session: {
      expiresIn: 3 * daySeconds,
      updateAge: daySeconds,
      additionalFields: {
        deviceBrowser: { type: 'string', required: true, input: false },
        deviceOs: { type: 'string', required: true, input: false },
        credentialId: { type: 'string', required: true, input: false },
      },
    },
    advanced: {
      database: { generateId: 'uuid' },
      ipAddress: { disableIpTracking: true },
      // Every cookie is __Host- (Secure, Path=/, no Domain), so a sibling filx.app subdomain
      // cannot plant one (spec 0003, R4). Better Auth would add __Secure- instead, so its own
      // prefix is off and the attributes are set here.
      useSecureCookies: false,
      cookiePrefix: '__Host-arca',
      defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: 'lax', path: '/' },
    },
    hooks: {
      // The options endpoint reads any session to list its passkeys; it must not slide it, since
      // only GET /v1/session may (spec 0003, R4).
      before: createAuthMiddleware((ctx): Promise<unknown> =>
        Promise.resolve(
          ctx.path === signInOptionsPath
            ? { context: { query: { ...ctx.query, disableRefresh: true } } }
            : undefined,
        ),
      ),
      // The plugin asks for user verification as "preferred"; Arca requires it (spec 0003, R3).
      // A refused sign-in with a known passkey is recorded; the refusal itself stands.
      after: createAuthMiddleware(async (ctx): Promise<unknown> => {
        const returned: unknown = ctx.context.returned;
        if (ctx.path === signInPath && returned instanceof APIError) {
          await recordFailedSignIn(ctx.body);
          return undefined;
        }
        if (
          ctx.path !== signInOptionsPath ||
          typeof returned !== 'object' ||
          returned === null ||
          returned instanceof Error
        ) {
          return undefined;
        }
        return ctx.json({ ...returned, userVerification: 'required' });
      }),
    },
    databaseHooks: {
      // Each challenge is consumed only on its own verify, so abandoned ones are swept here; the
      // table stays bounded by what one challenge lifetime can hold.
      verification: {
        create: {
          // A failed sweep only delays the cleanup; it never fails the ceremony.
          after: async () => {
            try {
              await db
                .delete(verificationTable)
                .where(lte(verificationTable.expiresAt, sql`now()`));
            } catch (error) {
              logger.error({
                errorName: `ChallengeSweep:${error instanceof Error ? error.name : 'NonErrorThrown'}`,
              });
            }
          },
        },
      },
      session: {
        create: {
          // Neither the IP address nor the raw user agent is stored; the device is two enums.
          // Sessions come only from a verified passkey, and each records its credential.
          before: (session, context) => {
            const credentialId = signingCredential(context);
            if (credentialId === undefined) {
              return Promise.reject(new APIError('UNAUTHORIZED', { code: 'NO_PASSKEY' }));
            }
            const { browser, os } = describeDevice(context?.headers?.get('user-agent'));
            return Promise.resolve({
              data: {
                ...session,
                ipAddress: null,
                userAgent: null,
                deviceBrowser: browser,
                deviceOs: os,
                credentialId,
              },
            });
          },
          // Every new session is a sign-in, whichever endpoint created it. The session row is
          // already committed here, so if either write fails the session is deleted and the
          // sign-in fails: no usable session goes unrecorded.
          after: async (session) => {
            try {
              await audit.record({
                code: 'sign_in',
                subjectAccountId: session.userId,
                actorAccountId: session.userId,
                details: describeSession(session),
              });
              await db
                .update(user)
                .set({ lastSignInAt: new Date() })
                .where(eq(user.id, session.userId));
            } catch (error) {
              await db.delete(sessionTable).where(eq(sessionTable.id, session.id));
              throw error;
            }
            // A notice that fails to send never blocks the sign-in; the failure is logged.
            try {
              await noticeSignIn(session);
            } catch (error) {
              logger.error({
                errorName: `SignInNotice:${error instanceof Error ? error.name : 'NonErrorThrown'}`,
              });
            }
          },
        },
      },
    },
    plugins: [
      passkey({
        rpID: new URL(origin).hostname,
        rpName: 'Arca',
        origin,
        authentication: {
          afterVerification: ({ verification }) => {
            requireUserVerified(verification.authenticationInfo.userVerified);
            return Promise.resolve();
          },
        },
      }),
    ],
  });

  /**
   * One `sign_in_failed` event per credential per window, and only for a passkey that exists
   * (spec 0003, R7): the person who holds it sees the attempts without the log filling up. A
   * failure here is logged and never changes the refusal.
   */
  async function recordFailedSignIn(body: unknown) {
    try {
      const credentialId = assertedCredential(body);
      if (credentialId === undefined) return;
      const [found] = await db
        .select({ id: passkeyTable.id, userId: passkeyTable.userId })
        .from(passkeyTable)
        .where(eq(passkeyTable.credentialID, credentialId));
      if (found === undefined) return;
      if (!(await limiter.hit(signInFailedLog, credentialId)).allowed) return;
      await audit.record({
        code: 'sign_in_failed',
        subjectAccountId: found.userId,
        actorAccountId: null,
        details: { passkeyId: found.id },
      });
    } catch (error) {
      logger.error({
        errorName: `SignInFailedLog:${error instanceof Error ? error.name : 'NonErrorThrown'}`,
      });
    }
  }

  async function noticeSignIn(session: Record<string, unknown> & { userId: string }) {
    const [account] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, session.userId));
    if (account === undefined) return;
    await noticeNewSignIn(
      { db, notices },
      {
        credentialId: String(session['credentialId']),
        device: describeSession(session),
        email: account.email,
        at: new Date(),
      },
    );
  }
}

export type Auth = ReturnType<typeof createAuth>;

/** The device enums the create hook stored; parsed again by the audit log. */
function describeSession(session: Record<string, unknown>) {
  return DeviceDescription.parse({ browser: session['deviceBrowser'], os: session['deviceOs'] });
}
