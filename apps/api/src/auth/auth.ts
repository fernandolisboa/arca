import { passkey } from '@better-auth/passkey';
import { authSchema, session as sessionTable, user } from '@arca/db/auth-schema';
import type { Database } from '@arca/db';
import { betterAuth } from 'better-auth';
import { eq } from 'drizzle-orm';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { authBasePath, DeviceDescription } from '@arca/api-contract/routes';
import type { AuditLog } from '../audit/log.js';
import type { Logger } from '../logger.js';
import { describeDevice } from './device.js';

export interface AuthSettings {
  /** A database on the app_auth pool; no other role may read the auth schema. */
  readonly db: Database;
  readonly secret: string;
  /** The environment's own origin, the only one trusted (spec 0003, R4 and R9). */
  readonly origin: string;
  readonly logger: Logger;
  /** Every sign-in is recorded (spec 0003, R7). */
  readonly audit: AuditLog;
}

/**
 * Better Auth with the passkey plugin (spec 0003, R1). Only passkeys sign in: email and password,
 * magic links, social and anonymous sign-in are never configured, and the router in front of it
 * lets through only the allow-listed endpoints. Telemetry is off.
 */
export function createAuth({ db, secret, origin, logger, audit }: AuthSettings) {
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
    session: {
      additionalFields: {
        deviceBrowser: { type: 'string', required: true, input: false },
        deviceOs: { type: 'string', required: true, input: false },
      },
    },
    advanced: {
      database: { generateId: 'uuid' },
      ipAddress: { disableIpTracking: true },
    },
    databaseHooks: {
      session: {
        create: {
          // Neither the IP address nor the raw user agent is stored; the device is two enums.
          before: (session, context) => {
            const { browser, os } = describeDevice(context?.headers?.get('user-agent'));
            return Promise.resolve({
              data: {
                ...session,
                ipAddress: null,
                userAgent: null,
                deviceBrowser: browser,
                deviceOs: os,
              },
            });
          },
          // Every new session is a sign-in, whichever endpoint created it. The session row is
          // already committed here, so if the event cannot be recorded the session is deleted
          // and the sign-in fails: no usable session goes unrecorded.
          after: async (session) => {
            try {
              await audit.record({
                code: 'sign_in',
                subjectAccountId: session.userId,
                actorAccountId: session.userId,
                details: describeSession(session),
              });
            } catch (error) {
              await db.delete(sessionTable).where(eq(sessionTable.id, session.id));
              throw error;
            }
            await db
              .update(user)
              .set({ lastSignInAt: new Date() })
              .where(eq(user.id, session.userId));
          },
        },
      },
    },
    plugins: [passkey({ rpID: new URL(origin).hostname, rpName: 'Arca', origin })],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** The device enums the create hook stored; parsed again by the audit log. */
function describeSession(session: Record<string, unknown>) {
  return DeviceDescription.parse({ browser: session['deviceBrowser'], os: session['deviceOs'] });
}
