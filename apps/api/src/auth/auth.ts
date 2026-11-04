import { passkey } from '@better-auth/passkey';
import {
  authSchema,
  passkey as passkeyTable,
  session as sessionTable,
  user,
  verification as verificationTable,
} from '@arca/db/auth-schema';
import type { Database, Transaction } from '@arca/db';
import { passkeyActivation, passkeyCapability } from '@arca/db/enrollment-schema';
import type { AuthenticationExtensionsClientInputs } from '@simplewebauthn/server';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';
import {
  and,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  ne,
  not,
  sql,
} from 'drizzle-orm';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { authBasePath, DeviceDescription } from '@arca/api-contract/routes';
import type { AuditLog } from '../audit/log.js';
import type { Notices } from '../email/notices.js';
import type { Logger } from '../logger.js';
import { describeDevice } from './device.js';
import { signInFailedLog } from './limits.js';
import type { RateLimiter } from './rate-limit.js';
import type { RegistrationHooks } from './registration.js';
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
  readonly limiter: Pick<RateLimiter, 'hit'>;
  /** Passkey-first registration's callbacks, which share the adapter's transactions. */
  readonly registration: RegistrationHooks;
}

const daySeconds = 24 * 60 * 60;
const signInPath = '/passkey/verify-authentication';
const signInOptionsPath = '/passkey/generate-authenticate-options';
const registrationPath = '/passkey/verify-registration';
/** SimpleWebAuthn's types predate PRF; an empty request only asks whether it is supported. */
const prfSupportProbe = { prf: {} } as AuthenticationExtensionsClientInputs;

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
export function createAuth({
  db,
  secret,
  origin,
  logger,
  audit,
  notices,
  limiter,
  registration,
}: AuthSettings) {
  return betterAuth({
    appName: 'Arca',
    baseURL: origin,
    basePath: authBasePath,
    secret,
    trustedOrigins: [origin],
    // Real transactions, so a registration's account, passkey and session commit together.
    database: drizzleAdapter(registration.adapterDb, {
      provider: 'pg',
      schema: authSchema,
      transaction: true,
    }),
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
        confirmedAt: { type: 'date', required: false, input: false },
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
        if (ctx.path === signInPath && isAPIError(returned)) {
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
          before: async (session, context) => {
            const credentialId =
              context?.path === registrationPath
                ? await registration.registeredPasskey()
                : signingCredential(context);
            if (credentialId === undefined) {
              throw new APIError('UNAUTHORIZED', { code: 'NO_PASSKEY' });
            }
            const { browser, os } = describeDevice(context?.headers?.get('user-agent'));
            return {
              data: {
                ...session,
                ipAddress: null,
                userAgent: null,
                deviceBrowser: browser,
                deviceOs: os,
                credentialId,
              },
            };
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
        // A discoverable credential with user verification, and PRF asked only to learn whether
        // the authenticator supports it (spec 0003, R3; ADR-0018).
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        registration: {
          requireSession: false,
          extensions: prfSupportProbe,
          resolveUser: registration.resolveUser,
          afterVerification: registration.afterVerification,
        },
        authentication: {
          // A passkey added to the account signs nothing in for its first 24 hours (spec 0003,
          // R4); a refusal here is recorded like any other failed sign-in.
          afterVerification: async ({ verification }) => {
            requireUserVerified(verification.authenticationInfo.userVerified);
            if (await isPending(db, verification.authenticationInfo.credentialID)) {
              throw new APIError('UNAUTHORIZED', { code: 'PASSKEY_PENDING' });
            }
          },
        },
      }),
    ],
  });

  /**
   * One `sign_in_failed` event per credential per window, and only for a passkey that exists
   * (spec 0003, R7): the person who holds it sees the attempts without the log filling up. A
   * failure here is logged and never changes the refusal. The counter is spent before the write,
   * so a failed write leaves that credential without an event until the window ends.
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
    const email = await accounts.emailOf(db, session.userId);
    if (email === undefined) return;
    await noticeNewSignIn(
      { db, notices },
      {
        credentialId: String(session['credentialId']),
        device: describeSession(session),
        email,
        at: new Date(),
      },
    );
  }
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * The account rows the rest of the API needs, so the auth schema is read here alone (spec 0003,
 * R1). Each takes the database or the transaction to run in.
 */
export const accounts = {
  anyExists: async (db: Database | Transaction) =>
    (await db.select({ id: user.id }).from(user).limit(1)).length > 0,
  /** An account confirmed from the start, as owner enrollment creates it (spec 0003, R2). */
  createConfirmed: async (db: Database | Transaction, email: string) => {
    const [created] = await db
      .insert(user)
      .values({ name: '', email, emailVerified: true, confirmedAt: sql`now()` })
      .returning({ id: user.id });
    return created?.id;
  },
  /** An invited account, restricted until its inviter confirms it (spec 0003, R2). */
  createUnconfirmed: async (db: Database | Transaction, email: string) => {
    const [created] = await db
      .insert(user)
      .values({ name: '', email, emailVerified: true })
      .returning({ id: user.id });
    return created?.id;
  },
  /** Holds the account's row until the transaction ends, so its writes run one at a time. */
  lock: async (tx: Transaction, accountId: string) =>
    (await tx.select({ id: user.id }).from(user).where(eq(user.id, accountId)).for('update'))
      .length === 1,
  /** The accounts among these that are confirmed. */
  confirmedAmong: async (db: Database | Transaction, accountIds: readonly string[]) =>
    new Set(
      accountIds.length === 0
        ? []
        : (
            await db
              .select({ id: user.id })
              .from(user)
              .where(and(inArray(user.id, [...accountIds]), isNotNull(user.confirmedAt)))
          ).map(({ id }) => id),
    ),
  isConfirmed: async (db: Database | Transaction, accountId: string) =>
    (
      await db
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, accountId), isNotNull(user.confirmedAt)))
    ).length === 1,
  /** False when the account is gone or already confirmed. */
  confirm: async (db: Database | Transaction, accountId: string) =>
    (
      await db
        .update(user)
        .set({ confirmedAt: sql`now()` })
        .where(and(eq(user.id, accountId), isNull(user.confirmedAt)))
        .returning({ id: user.id })
    ).length === 1,
  /**
   * Erases an account that was never confirmed, with every auth row through the cascades. An
   * unconfirmed account can hold nothing outside the auth schema yet; the full erasure (spec 0004,
   * R9) takes over once it can.
   */
  eraseUnconfirmed: async (db: Database | Transaction, accountId: string) =>
    (
      await db
        .delete(user)
        .where(and(eq(user.id, accountId), isNull(user.confirmedAt)))
        .returning({ id: user.id })
    ).length === 1,
  withEmail: async (db: Database | Transaction, email: string) =>
    (await db.select({ id: user.id }).from(user).where(eq(user.email, email))).length > 0,
  emailOf: async (db: Database | Transaction, accountId: string) =>
    (await db.select({ email: user.email }).from(user).where(eq(user.id, accountId)))[0]?.email,
  createdWithinDay: async (db: Database | Transaction, accountId: string) =>
    (
      await db
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, accountId), gt(user.createdAt, sql`now() - interval '1 day'`)))
    ).length === 1,
};

/** A passkey added to the account that is still in its 24 hours (spec 0003, R4). */
const pending = (credentialId: typeof passkeyTable.credentialID) =>
  exists(
    sql`(SELECT 1 FROM ${passkeyActivation}
          WHERE ${passkeyActivation.credentialID} = ${credentialId}
            AND ${passkeyActivation.activeFrom} > now())`,
  );

async function isPending(db: Database | Transaction, credentialId: string) {
  const [found] = await db
    .select({ activeFrom: passkeyActivation.activeFrom })
    .from(passkeyActivation)
    .where(
      and(
        eq(passkeyActivation.credentialID, credentialId),
        gt(passkeyActivation.activeFrom, sql`now()`),
      ),
    );
  return found !== undefined;
}

/** How long an added passkey waits before it can sign in or approve a step-up (spec 0003, R4). */
export const pendingPasskeyHours = 24;

/** A passkey to store for the account, as a verified registration describes it. */
export interface NewPasskey {
  readonly credentialId: string;
  /** COSE, base64, as the passkey plugin stores it. */
  readonly publicKey: string;
  readonly counter: number;
  readonly deviceType: string;
  readonly backedUp: boolean;
  readonly transports: readonly string[];
  readonly aaguid: string;
  readonly prfEnabled: boolean;
}

/** The passkey and session rows the device list reads and revokes (spec 0003, R4). */
export const devices = {
  /** The account's passkeys, oldest first, and its sessions created after `since` and unexpired. */
  of: async (db: Database | Transaction, accountId: string, since: Date) => {
    const passkeys = await db
      .select({
        id: passkeyTable.id,
        credentialId: passkeyTable.credentialID,
        createdAt: passkeyTable.createdAt,
        pendingUntil:
          sql<Date | null>`(SELECT ${passkeyActivation.activeFrom} FROM ${passkeyActivation}
          WHERE ${passkeyActivation.credentialID} = ${passkeyTable.credentialID}
            AND ${passkeyActivation.activeFrom} > now())`.mapWith(passkeyActivation.activeFrom),
      })
      .from(passkeyTable)
      .where(eq(passkeyTable.userId, accountId))
      .orderBy(passkeyTable.createdAt, passkeyTable.id);
    const sessions = await db
      .select({
        id: sessionTable.id,
        credentialId: sessionTable.credentialId,
        browser: sessionTable.deviceBrowser,
        os: sessionTable.deviceOs,
        createdAt: sessionTable.createdAt,
        updatedAt: sessionTable.updatedAt,
      })
      .from(sessionTable)
      .where(
        and(
          eq(sessionTable.userId, accountId),
          gt(sessionTable.expiresAt, sql`now()`),
          gt(sessionTable.createdAt, since),
        ),
      )
      .orderBy(desc(sessionTable.updatedAt), sessionTable.id);
    return { passkeys, sessions };
  },
  /** False when the session is not the account's. */
  revokeSession: async (db: Database | Transaction, accountId: string, sessionId: string) =>
    (
      await db
        .delete(sessionTable)
        .where(and(eq(sessionTable.id, sessionId), eq(sessionTable.userId, accountId)))
        .returning({ id: sessionTable.id })
    ).length === 1,
  /**
   * Every session of the account but the one kept; the IDs of those it ended that were still
   * live, as `of` lists them. Dead ones go too, unrecorded, since nobody could see or use them.
   */
  revokeOtherSessions: async (
    db: Database | Transaction,
    accountId: string,
    kept: string,
    since: Date,
  ) =>
    (
      await db
        .delete(sessionTable)
        .where(and(eq(sessionTable.userId, accountId), ne(sessionTable.id, kept)))
        .returning({
          id: sessionTable.id,
          live: sql<boolean>`${sessionTable.expiresAt} > now() AND ${sessionTable.createdAt} > ${since}`,
        })
    )
      .filter(({ live }) => live)
      .map(({ id }) => id),
  /**
   * Deletes one of the account's passkeys, whose sessions and recorded clients go with it by
   * their cascades, unless it is the account's last. Its credential ID when it was deleted.
   */
  revokePasskey: async (tx: Transaction, accountId: string, passkeyId: string) => {
    // The passkey rows are locked in one order, so two revocations at once cannot each leave the
    // other as the last passkey, and a step-up still recording (its counter update holds the row)
    // commits first. Not the account row: the step-up's insert checks its key against it.
    const owned = await tx
      .select({
        id: passkeyTable.id,
        credentialId: passkeyTable.credentialID,
        pending: pending(passkeyTable.credentialID),
      })
      .from(passkeyTable)
      .where(eq(passkeyTable.userId, accountId))
      .orderBy(passkeyTable.id)
      .for('update', { of: passkeyTable });
    const target = owned.find(({ id }) => id === passkeyId);
    if (target === undefined) return 'not_found' as const;
    // A pending passkey can always be cancelled; the last active one stays, and a pending one
    // does not count as another.
    if (!target.pending && !owned.some((other) => other !== target && !other.pending)) {
      return 'last_active' as const;
    }
    await tx.delete(passkeyTable).where(eq(passkeyTable.id, passkeyId));
    return { credentialId: target.credentialId, pending: target.pending };
  },
  /** The account's credentials, for the authenticator to refuse registering one again. */
  credentialsOf: async (db: Database | Transaction, accountId: string) =>
    (
      await db
        .select({ id: passkeyTable.credentialID, transports: passkeyTable.transports })
        .from(passkeyTable)
        .where(eq(passkeyTable.userId, accountId))
    ).map(({ id, transports }) => ({
      id,
      transports: (transports ?? '').split(',').filter((transport) => transport !== ''),
    })),
  /**
   * Stores another passkey for the account, pending for 24 hours, with what its authenticator
   * reported; its ID, or undefined when the credential is already stored.
   */
  addPending: async (tx: Transaction, accountId: string, added: NewPasskey) => {
    const [stored] = await tx
      .insert(passkeyTable)
      .values({
        userId: accountId,
        credentialID: added.credentialId,
        publicKey: added.publicKey,
        counter: added.counter,
        deviceType: added.deviceType,
        backedUp: added.backedUp,
        transports: added.transports.join(','),
        aaguid: added.aaguid,
      })
      .onConflictDoNothing()
      .returning({ id: passkeyTable.id });
    if (stored === undefined) return undefined;
    await tx.insert(passkeyActivation).values({
      credentialID: added.credentialId,
      activeFrom: sql`now() + make_interval(hours => ${pendingPasskeyHours})`,
    });
    await tx
      .insert(passkeyCapability)
      .values({ credentialID: added.credentialId, prfEnabled: added.prfEnabled });
    return stored.id;
  },
  /** When the account's newest pending passkey becomes active, or null when none is pending. */
  pendingUntil: async (db: Database | Transaction, accountId: string) => {
    const [found] = await db
      .select({ until: max(passkeyActivation.activeFrom) })
      .from(passkeyActivation)
      .innerJoin(passkeyTable, eq(passkeyTable.credentialID, passkeyActivation.credentialID))
      .where(and(eq(passkeyTable.userId, accountId), gt(passkeyActivation.activeFrom, sql`now()`)));
    return found?.until ?? null;
  },
  /** Forgets the waits that are over; the IDs of the passkeys that became active. */
  activateDue: async (tx: Transaction, accountId: string) => {
    const due = await tx
      .delete(passkeyActivation)
      .where(
        and(
          lte(passkeyActivation.activeFrom, sql`now()`),
          inArray(
            passkeyActivation.credentialID,
            tx
              .select({ id: passkeyTable.credentialID })
              .from(passkeyTable)
              .where(eq(passkeyTable.userId, accountId)),
          ),
        ),
      )
      .returning({ credentialId: passkeyActivation.credentialID });
    if (due.length === 0) return [];
    return (
      await tx
        .select({ id: passkeyTable.id })
        .from(passkeyTable)
        .where(
          inArray(
            passkeyTable.credentialID,
            due.map(({ credentialId }) => credentialId),
          ),
        )
    ).map(({ id }) => id);
  },
};

/** A passkey as a step-up verifies against it. */
export interface StoredCredential {
  readonly credentialId: string;
  /** COSE, as the passkey plugin stores it. */
  readonly publicKey: Uint8Array<ArrayBuffer>;
  readonly counter: number;
  readonly transports: readonly string[];
}

/** The credential reads and writes the rest of the API needs; nothing else reads the rows. */
export interface CredentialStore {
  /** The account's passkeys that may approve a step-up. */
  readonly activeOf: (accountId: string) => Promise<readonly StoredCredential[]>;
  readonly active: (accountId: string, credentialId: string) => Promise<StoredCredential | null>;
  /**
   * Records a verified signature counter and, in the same transaction, what the verification
   * approved. False when another verification moved the counter first, so two assertions with one
   * counter value never both pass, or when the passkey is gone: the counter's row lock makes a
   * revocation wait for this commit, so it also ends what was recorded (spec 0003, R4).
   */
  readonly advanceCounter: (
    accountId: string,
    credentialId: string,
    counter: number,
    record: (tx: Transaction) => Promise<void>,
  ) => Promise<boolean>;
}

/**
 * A passkey still in its 24 hours is never active (spec 0003, R4); a revoked one is deleted, so it
 * is never found.
 */
export function credentialStore(db: Database): CredentialStore {
  const columns = {
    credentialId: passkeyTable.credentialID,
    publicKey: passkeyTable.publicKey,
    counter: passkeyTable.counter,
    transports: passkeyTable.transports,
  };
  const toCredential = (row: {
    credentialId: string;
    publicKey: string;
    counter: number;
    transports: string | null;
  }): StoredCredential => ({
    credentialId: row.credentialId,
    publicKey: new Uint8Array(Buffer.from(row.publicKey, 'base64')),
    counter: row.counter,
    transports: (row.transports ?? '').split(',').filter((transport) => transport !== ''),
  });
  return {
    activeOf: async (accountId) =>
      (
        await db
          .select(columns)
          .from(passkeyTable)
          .where(and(eq(passkeyTable.userId, accountId), not(pending(passkeyTable.credentialID))))
          .orderBy(passkeyTable.createdAt)
      ).map(toCredential),
    active: async (accountId, credentialId) => {
      const [row] = await db
        .select(columns)
        .from(passkeyTable)
        .where(
          and(
            eq(passkeyTable.userId, accountId),
            eq(passkeyTable.credentialID, credentialId),
            not(pending(passkeyTable.credentialID)),
          ),
        );
      return row === undefined ? null : toCredential(row);
    },
    advanceCounter: (accountId, credentialId, counter, record) =>
      db.transaction(async (tx) => {
        // The account row first, as every erasure locks it before its passkeys, so a step-up
        // recording while the account is erased cannot deadlock with it.
        const [held] = await tx
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, accountId))
          .for('key share');
        if (held === undefined) return false;
        const moved = await tx
          .update(passkeyTable)
          .set({ counter })
          .where(
            and(
              eq(passkeyTable.credentialID, credentialId),
              eq(passkeyTable.userId, accountId),
              // Authenticators without a counter always send 0, which verification only lets
              // through while the stored counter is 0 too.
              counter === 0 ? eq(passkeyTable.counter, 0) : lt(passkeyTable.counter, counter),
            ),
          )
          .returning({ credentialId: passkeyTable.credentialID });
        if (moved.length !== 1) return false;
        await record(tx);
        return true;
      }),
  };
}

/** The device enums the create hook stored; parsed again by the audit log. */
function describeSession(session: Record<string, unknown>) {
  return DeviceDescription.parse({ browser: session['deviceBrowser'], os: session['deviceOs'] });
}
