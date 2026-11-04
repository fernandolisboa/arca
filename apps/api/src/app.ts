import { OpenAPIHono } from '@hono/zod-openapi';
import {
  addPasskey,
  addPasskeyOptions,
  apiBasePath,
  AuditEventsQuery,
  authBasePath,
  authRoutes,
  confirmInvite,
  createInvite,
  declineInvite,
  enrollOwner,
  inviteDetails,
  recoveryOptions,
  recoveryRedeem,
  recoveryStart,
  recoveryVerify,
  regenerateRecoveryKit,
  registrationOptions,
  registrationVerify,
  revokeOtherSessions,
  revokePasskey,
  revokeSession,
  StepUpAction,
  stepUpNonceHeader,
  StepUpOptionsRequest,
  stepUpVerify,
  type ErrorResponse,
  type RouteDefinition,
} from '@arca/api-contract/routes';
import { openApiRoutes } from '@arca/api-contract/server';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createMiddleware } from 'hono/factory';
import { routePath } from 'hono/route';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AuditReader } from './audit/log.js';
import { describeDevice } from './auth/device.js';
import type { AccountStatus, Devices } from './auth/devices.js';
import type { Enrollment } from './auth/enrollment.js';
import type { Invites } from './auth/invites.js';
import {
  authRouteLimits,
  deviceLimits,
  inviteLimits,
  recoveryLimits,
  registrationLimits,
  stepUpLimits,
} from './auth/limits.js';
import type { RateLimiter, RateLimitRule } from './auth/rate-limit.js';
import type { RecoveryKits } from './auth/recovery-kit.js';
import type { Recovery } from './auth/recovery.js';
import { behindAnswerOf } from './behind-answer.js';
import type { Registration, RegistrationOutcome } from './auth/registration.js';
import type { AuthService, SignedIn } from './auth/service.js';
import type { CanonicalAction } from './auth/step-up-encoding.js';
import type { ActionPurpose, StepUpService } from './auth/step-up.js';
import type { OutboxEntry } from './email/outbox.js';
import { bearerMatches } from './cron-auth.js';
import { cachedDatabaseCheck, type CheckDatabase } from './database-health.js';
import { securityTxt } from './security-txt.js';
import type { Logger } from '@arca/telemetry';
import { utcDate, type IsoDate } from './workflows/workflow-arguments.js';

/** What the cron routes need; absent in tests that do not exercise them. */
export interface CronDependencies {
  /** Throws when `CRON_SECRET` is not set, which answers 500. */
  readonly readSecret: () => string;
  readonly startHeartbeat: (runDate: IsoDate) => Promise<unknown>;
  /** Deletes the rate-limit windows that have ended (spec 0003, R10). */
  readonly sweepRateLimits: () => Promise<number>;
  readonly clock?: () => Date;
}

/** Limits on the auth routes (spec 0003, R10); required whenever `auth` is given. */
export interface AuthLimits {
  readonly limiter: Pick<RateLimiter, 'hit'>;
  /** The client's IP address, which the limiter HMACs before storing anything. */
  readonly clientAddress: (headers: Headers) => string;
}

export interface AppDependencies {
  readonly checkDatabase: CheckDatabase;
  readonly logger: Logger;
  /** Monotonic milliseconds, for durations and the health cache. */
  readonly now?: () => number;
  readonly newRequestId?: () => string;
  readonly cron?: CronDependencies;
  /**
   * The environment's own origin, the only one a state-changing `/v1` request may come from
   * (spec 0003, R4); absent, every such request is refused.
   */
  readonly origin?: string;
  /**
   * True where new accounts can be made; absent or false, as in a production with no sending
   * domain (spec 0003, R9), enrollment, invites, registration and recovery answer 503
   * `accounts_closed`.
   */
  readonly accountsOpen?: boolean;
  /** Better Auth behind the allow-list; absent, every auth path is a 404. */
  readonly auth?: AuthService;
  readonly authLimits?: AuthLimits;
  /** Purpose-bound step-up (spec 0003, R5); absent, its routes answer 401. */
  readonly stepUp?: StepUpService;
  /** Owner enrollment (spec 0003, R2); absent, its route is a 404. */
  readonly enrollment?: Enrollment;
  /** Passkey-first registration from a link (spec 0003, R2); absent, its routes are a 404. */
  readonly registration?: Registration;
  /** The account part of the recovery kit (spec 0003, R6); absent, its routes answer 401. */
  readonly recoveryKits?: RecoveryKits;
  /** Invites and their confirmation (spec 0003, R2); absent, their routes answer 401 or 404. */
  readonly invites?: Invites;
  /** The device list and its revocations (spec 0003, R4); absent, their routes answer 401. */
  readonly devices?: Devices;
  /** Recovery by email link and recovery code (spec 0003, R6); absent, its routes are a 404. */
  readonly recovery?: Recovery;
  /** The signed-in account's audit events; absent, the route answers 401. */
  readonly audit?: AuditReader;
  /**
   * The outbox's messages, given only on preview deployments, which Vercel Deployment
   * Protection keeps private (spec 0003, R8); absent, `/internal/outbox` is a 404.
   */
  readonly outbox?: () => Promise<readonly OutboxEntry[]>;
}

export type ErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'cross_origin'
  | 'not_found'
  | 'rate_limited'
  | 'step_up_refused'
  | 'step_up_required'
  | 'invalid_code'
  | 'registration_refused'
  | 'email_unavailable'
  | 'account_unconfirmed'
  | 'too_many_invites'
  | 'signed_in'
  | 'last_active_passkey'
  | 'passkey_refused'
  | 'recovery_locked'
  | 'recovery_pending'
  | 'accounts_closed'
  | 'request_failed'
  | 'internal_error';

/** The session a request is signed in with, and what its account's passkeys say about it. */
interface RequestSession {
  readonly current: SignedIn | null;
  readonly status: AccountStatus | null;
}

export interface AppEnv {
  Variables: {
    requestId: string;
    errorCode?: ErrorCode;
    /** The request's session and its account's status, looked up once per request. */
    session?: Promise<RequestSession>;
    /** Class name of a thrown error; never its message, which may carry data. */
    errorName?: string;
  };
}

const noStorePrefixes = [apiBasePath, '/internal'] as const;
const databaseCacheMs = 10_000;
const databaseTimeoutMs = 2_000;

/** Thrown values that are not Error instances are wrapped so they take the normal error path. */
class NonErrorThrown extends Error {
  override name = 'NonErrorThrown';
}

function reject(c: Context<AppEnv>, code: ErrorCode, status: ContentfulStatusCode) {
  c.set('errorCode', code);
  return c.json({ error: { code } } satisfies ErrorResponse, status);
}

function handleError(error: Error, c: Context<AppEnv>) {
  const status: ContentfulStatusCode = error instanceof HTTPException ? error.status : 500;
  c.set('errorName', error instanceof HTTPException ? 'HTTPException' : error.name);
  return reject(c, status >= 500 ? 'internal_error' : 'request_failed', status);
}

const safeMethods: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Refuses a state-changing request from anywhere but the environment's own origin: `Origin` must
 * match exactly, or, without it, `Sec-Fetch-Site` must say `same-origin`, so a sibling `filx.app`
 * subdomain counts as another site (spec 0003, R4). `SameSite=Lax` is not the only guard.
 */
function sameOrigin(origin: string | undefined) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (safeMethods.has(c.req.method)) return next();
    const sent = c.req.header('origin');
    const allowed =
      sent === undefined ? c.req.header('sec-fetch-site') === 'same-origin' : sent === origin;
    if (origin === undefined || !allowed) return reject(c, 'cross_origin', 403);
    return next();
  });
}

/**
 * Better Auth's answer re-encoded through the contract: only the schema's fields reach the
 * client, so no session token leaves in a body; errors carry our codes, never its messages. The
 * cookies it set pass through.
 */
async function throughContract(c: Context<AppEnv>, route: RouteDefinition, response: Response) {
  for (const cookie of response.headers.getSetCookie())
    c.header('set-cookie', cookie, { append: true });
  const status = response.status as ContentfulStatusCode;
  if (!response.ok) {
    await response.body?.cancel();
    // One answer for every refusal, so a sign-in never tells whether a credential exists.
    return status >= 500 ? reject(c, 'internal_error', status) : reject(c, 'unauthorized', 401);
  }
  return c.json(route.response.schema.parse(await response.json()), status);
}

/** The JSON body, read from a clone so the request still reaches Better Auth intact. */
async function bodyOf(request: Request): Promise<unknown> {
  try {
    return await request.clone().json();
  } catch {
    return undefined;
  }
}

/** A router whose validation failures answer `invalid_request` without the validator's details. */
export function createRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => (result.success ? undefined : reject(c, 'invalid_request', 400)),
  });
}

/** A route and a request matched by exact method and path. */
const routeKey = ({ method, path }: Pick<RouteDefinition, 'method' | 'path'>) =>
  `${method.toUpperCase()} ${apiBasePath}${path}`;
const requestKey = (c: Context) => `${c.req.method} ${c.req.path}`;

/** The API as a plain Hono app, importable and testable without the Nitro shell. */
export function createApp({
  checkDatabase,
  logger,
  now = () => performance.now(),
  newRequestId = () => crypto.randomUUID(),
  cron,
  origin,
  accountsOpen = false,
  auth,
  authLimits,
  stepUp,
  enrollment,
  registration,
  recoveryKits,
  invites,
  devices,
  recovery,
  audit,
  outbox,
}: AppDependencies) {
  // An auth route without its limit would be the gap the limits exist to close.
  if (auth !== undefined && authLimits === undefined) {
    throw new Error('the auth routes need their rate limits');
  }
  const app = createRouter();

  const observe = createMiddleware<AppEnv>(async (c, next) => {
    const started = now();
    const requestId = newRequestId();
    c.set('requestId', requestId);
    try {
      await next();
    } catch (thrown) {
      c.res = handleError(thrown instanceof Error ? thrown : new NonErrorThrown(), c);
    }
    c.header('X-Request-Id', requestId);
    if (
      noStorePrefixes.some((prefix) => c.req.path === prefix || c.req.path.startsWith(`${prefix}/`))
    ) {
      c.header('Cache-Control', 'no-store');
    }
    const errorCode = c.get('errorCode');
    const errorName = c.get('errorName');
    logger[c.res.status >= 500 ? 'error' : 'info']({
      requestId,
      method: c.req.method,
      route: routePath(c),
      status: c.res.status,
      durationMs: Math.round(now() - started),
      ...(errorCode === undefined ? {} : { errorCode }),
      ...(errorName === undefined ? {} : { errorName }),
    });
  });
  app.use('*', observe);
  app.use(`${apiBasePath}/*`, sameOrigin(origin));
  app.onError(handleError);
  app.notFound((c) => reject(c, 'not_found', 404));

  const v1 = createRouter();
  const databaseStatus = cachedDatabaseCheck(checkDatabase, {
    ttlMs: databaseCacheMs,
    timeoutMs: databaseTimeoutMs,
    now,
  });

  v1.openapi(openApiRoutes.health, async (c) => {
    const database = await databaseStatus();
    return c.json(
      {
        status: database === 'ok' ? 'ok' : 'degraded',
        checks: { database },
        accounts: accountsOpen ? 'open' : 'closed',
      },
      200,
    );
  });

  const lookUp = async (headers: Headers): Promise<RequestSession> => {
    if (auth === undefined) return { current: null, status: null };
    const current = await auth.signedIn(headers);
    if (current === null || devices === undefined) return { current, status: null };
    const status = await devices.status(current.accountId, current.sessionId);
    return { current: status.sessionEnded ? null : current, status };
  };
  const sessionOf = (c: Context<AppEnv>) => {
    let found = c.get('session');
    if (found === undefined) {
      found = lookUp(c.req.raw.headers);
      c.set('session', found);
    }
    return found;
  };
  const signedIn = async (c: Context<AppEnv>) => (await sessionOf(c)).current;
  /** Counts the request; over the limit, the 429 to answer with. */
  const overLimit = async (
    c: Context<AppEnv>,
    limits: AuthLimits,
    rule: RateLimitRule,
    subject: string,
  ) => {
    const outcome = await limits.limiter.hit(rule, subject);
    if (outcome.allowed) return undefined;
    c.header('Retry-After', String(outcome.retryAfterSeconds));
    c.set('errorCode', 'rate_limited');
    return c.json({ error: { code: 'rate_limited' } } satisfies ErrorResponse, 429);
  };
  const fail = <Status extends 401 | 403 | 404 | 409 | 503>(
    c: Context<AppEnv>,
    code: ErrorCode,
    status: Status,
  ) => {
    c.set('errorCode', code);
    return c.json({ error: { code } } satisfies ErrorResponse, status);
  };
  const unauthorized = (c: Context<AppEnv>) => fail(c, 'unauthorized', 401);
  /** Counted per client address, for the routes that come before any session. */
  const overAddressLimit = (c: Context<AppEnv>, limits: AuthLimits, rule: RateLimitRule) =>
    overLimit(c, limits, rule, limits.clientAddress(c.req.raw.headers));
  /**
   * `requireStepUp` (spec 0003, R5): spends this session's step-up for the purpose and for the
   * action recomputed from this request, with the nonce the client sent in its header.
   */
  const stepUpGranted = async (
    c: Context<AppEnv>,
    current: SignedIn,
    purpose: ActionPurpose,
    action: Omit<CanonicalAction, 'nonce'>,
  ) => {
    const nonce = StepUpAction.shape.nonce.safeParse(c.req.header(stepUpNonceHeader));
    if (stepUp === undefined || !nonce.success) return false;
    return stepUp.consume(current, purpose, {
      ...action,
      nonce: new Uint8Array(Buffer.from(nonce.data, 'base64url')),
    });
  };
  const registered = <Body extends object>(
    c: Context<AppEnv>,
    outcome: RegistrationOutcome<Body>,
  ) => {
    if (!outcome.ok) {
      if (outcome.reason === 'not_found') return fail(c, 'not_found', 404);
      return fail(
        c,
        outcome.reason === 'invalid_code' ? 'invalid_code' : 'registration_refused',
        403,
      );
    }
    for (const cookie of outcome.setCookies) c.header('set-cookie', cookie, { append: true });
    return c.json(outcome.body, 200);
  };

  /** Every route that makes, or proves the address of, an account (spec 0003, R9). */
  const makingAccounts = new Set(
    [
      openApiRoutes.enrollOwner,
      openApiRoutes.registrationOptions,
      openApiRoutes.registrationVerify,
      openApiRoutes.createInvite,
      openApiRoutes.inviteDetails,
      openApiRoutes.recoveryStart,
      openApiRoutes.recoveryRedeem,
      openApiRoutes.recoveryOptions,
      openApiRoutes.recoveryVerify,
    ].map(routeKey),
  );
  v1.use(
    '*',
    createMiddleware<AppEnv>(async (c, next) => {
      if (!accountsOpen && makingAccounts.has(requestKey(c))) {
        return reject(c, 'accounts_closed', 503);
      }
      return next();
    }),
  );

  /**
   * While a recovery passkey waits, a session of its account may only show so and cancel it
   * from the device list (spec 0003, R6); every other route answers 403 `recovery_pending`.
   * Signing in and out stay open, so a shared device can still change hands; the recovery routes
   * never read a session, so a cookie this browser still holds does not matter.
   */
  const whileRecoveryPending = new Set(
    [
      openApiRoutes.session,
      openApiRoutes.listDevices,
      openApiRoutes.revokePasskey,
      openApiRoutes.stepUpOptions,
      openApiRoutes.stepUpVerify,
      openApiRoutes.recoveryStart,
      openApiRoutes.recoveryRedeem,
      openApiRoutes.recoveryOptions,
      openApiRoutes.recoveryVerify,
      ...authRoutes,
    ].map(routeKey),
  );
  const restrictWhileRecoveryPending = createMiddleware<AppEnv>(async (c, next) => {
    // Only a cookie carries a session, so a request without one has nothing to restrict.
    if (c.req.header('cookie') === undefined) return next();
    if (whileRecoveryPending.has(requestKey(c))) return next();
    const { current, status } = await sessionOf(c);
    if (current !== null && status?.recoveryPending === true) {
      return reject(c, 'recovery_pending', 403);
    }
    return next();
  });
  v1.use('*', restrictWhileRecoveryPending);

  v1.openapi(openApiRoutes.session, async (c) => {
    if (auth === undefined) return unauthorized(c);
    // Looked up first, so a recovery activation that ends this session is seen before it slides.
    const { status } = await sessionOf(c);
    const { session, setCookies } = await auth.refresh(c.req.raw.headers);
    for (const cookie of setCookies) c.header('set-cookie', cookie, { append: true });
    if (session === null) return unauthorized(c);
    return c.json(
      {
        ...session,
        pendingPasskeyUntil: status?.pendingUntil?.toISOString() ?? null,
        recoveryPending: status?.recoveryPending ?? false,
      },
      200,
    );
  });

  v1.openapi(openApiRoutes.stepUpOptions, async (c) => {
    const current = await signedIn(c);
    if (current === null || stepUp === undefined || authLimits === undefined) {
      return unauthorized(c);
    }
    const limited = await overLimit(c, authLimits, stepUpLimits.options, current.sessionId);
    if (limited !== undefined) return limited;
    // The router has already answered 400 to an invalid body; parsed again for its type.
    const request = StepUpOptionsRequest.parse(await c.req.json());
    return c.json(await stepUp.options(current, request), 200);
  });

  v1.openapi(openApiRoutes.stepUpVerify, async (c) => {
    const current = await signedIn(c);
    if (current === null || stepUp === undefined || authLimits === undefined) {
      return unauthorized(c);
    }
    const limited = await overLimit(c, authLimits, stepUpLimits.verify, current.sessionId);
    if (limited !== undefined) return limited;
    const { challengeId, response } = stepUpVerify.body.parse(await c.req.json());
    // One answer for every refusal reason, apart from the session's own 401.
    if (!(await stepUp.verify(current, challengeId, response))) {
      return fail(c, 'step_up_refused', 403);
    }
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.enrollOwner, async (c) => {
    if (enrollment === undefined || authLimits === undefined) return fail(c, 'not_found', 404);
    const limited = await overAddressLimit(c, authLimits, registrationLimits.enrollOwner);
    if (limited !== undefined) return limited;
    const outcome = await enrollment.enrollOwner(enrollOwner.body.parse(await c.req.json()));
    if (outcome === 'not_found') return fail(c, 'not_found', 404);
    if (outcome === 'email_unavailable') return fail(c, 'email_unavailable', 503);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.registrationOptions, async (c) => {
    if (registration === undefined || authLimits === undefined) return fail(c, 'not_found', 404);
    const limited = await overAddressLimit(c, authLimits, registrationLimits.options);
    if (limited !== undefined) return limited;
    // The passkey plugin would build the options for the session's own account, so the device
    // would store a passkey that verify then refuses; a link registers a new account only.
    if ((await signedIn(c)) !== null) return fail(c, 'signed_in', 409);
    const request = registrationOptions.body.parse(await c.req.json());
    return registered(c, await registration.options(c.req.raw.headers, request));
  });

  v1.openapi(openApiRoutes.registrationVerify, async (c) => {
    if (registration === undefined || authLimits === undefined) return fail(c, 'not_found', 404);
    const limited = await overAddressLimit(c, authLimits, registrationLimits.verify);
    if (limited !== undefined) return limited;
    const request = registrationVerify.body.parse(await c.req.json());
    return registered(c, await registration.verify(c.req.raw.headers, request));
  });

  v1.openapi(openApiRoutes.recoveryKitStatus, async (c) => {
    const current = await signedIn(c);
    if (current === null || recoveryKits === undefined) return unauthorized(c);
    return c.json({ status: await recoveryKits.status(current.accountId) }, 200);
  });

  // The first kit comes with the account; replacing one needs a step-up (spec 0003, R6).
  v1.openapi(openApiRoutes.regenerateRecoveryKit, async (c) => {
    const current = await signedIn(c);
    if (current === null || recoveryKits === undefined) return unauthorized(c);
    const first = await recoveryKits.issueFirst(current.accountId);
    if (first !== null) return c.json({ code: first }, 200);
    const approved = await stepUpGranted(c, current, 'sensitive_settings', {
      action: regenerateRecoveryKit.operationId,
      targets: [],
    });
    if (!approved) return fail(c, 'step_up_required', 403);
    return c.json({ code: await recoveryKits.regenerate(current.accountId) }, 200);
  });

  v1.openapi(openApiRoutes.confirmRecoveryKit, async (c) => {
    const current = await signedIn(c);
    if (current === null || recoveryKits === undefined) return unauthorized(c);
    if (!(await recoveryKits.confirm(current.accountId))) return fail(c, 'not_found', 404);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.createInvite, async (c) => {
    const current = await signedIn(c);
    if (current === null || invites === undefined || authLimits === undefined) {
      return unauthorized(c);
    }
    const limited = await overLimit(c, authLimits, inviteLimits.create, current.accountId);
    if (limited !== undefined) return limited;
    const { email } = createInvite.body.parse(await c.req.json());
    const outcome = await invites.create(current.accountId, email);
    if (outcome === 'unconfirmed') return fail(c, 'account_unconfirmed', 403);
    if (outcome === 'too_many') return fail(c, 'too_many_invites', 409);
    if (outcome === 'email_unavailable') return fail(c, 'email_unavailable', 503);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.listInvites, async (c) => {
    const current = await signedIn(c);
    if (current === null || invites === undefined) return unauthorized(c);
    return c.json({ invites: [...(await invites.list(current.accountId))] }, 200);
  });

  v1.openapi(openApiRoutes.inviteDetails, async (c) => {
    if (invites === undefined || authLimits === undefined) return fail(c, 'not_found', 404);
    const limited = await overAddressLimit(c, authLimits, inviteLimits.details);
    if (limited !== undefined) return limited;
    const details = await invites.details(inviteDetails.body.parse(await c.req.json()).token);
    return details === undefined ? fail(c, 'not_found', 404) : c.json(details, 200);
  });

  // Both decisions are bound to the invite by a step-up (spec 0003, R2).
  for (const [route, decide] of [
    [confirmInvite, 'confirm'],
    [declineInvite, 'decline'],
  ] as const) {
    v1.openapi(openApiRoutes[route.operationId], async (c) => {
      const current = await signedIn(c);
      if (current === null || invites === undefined) return unauthorized(c);
      const { inviteId } = route.body.parse(await c.req.json());
      const approved = await stepUpGranted(c, current, 'sensitive_settings', {
        action: route.operationId,
        targets: [inviteId],
      });
      if (!approved) return fail(c, 'step_up_required', 403);
      if (!(await invites[decide](current.accountId, inviteId))) return fail(c, 'not_found', 404);
      return c.json({}, 200);
    });
  }

  v1.openapi(openApiRoutes.listDevices, async (c) => {
    const current = await signedIn(c);
    if (current === null || devices === undefined) return unauthorized(c);
    return c.json(await devices.list(current), 200);
  });

  // Each revocation is bound to its target by a step-up (spec 0003, R4).
  v1.openapi(openApiRoutes.revokeSession, async (c) => {
    const current = await signedIn(c);
    if (current === null || devices === undefined) return unauthorized(c);
    const { sessionId } = revokeSession.body.parse(await c.req.json());
    const approved = await stepUpGranted(c, current, 'sensitive_settings', {
      action: revokeSession.operationId,
      targets: [sessionId],
    });
    if (!approved) return fail(c, 'step_up_required', 403);
    if (!(await devices.revokeSession(current, sessionId))) return fail(c, 'not_found', 404);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.revokePasskey, async (c) => {
    const current = await signedIn(c);
    if (current === null || devices === undefined) return unauthorized(c);
    const { passkeyId } = revokePasskey.body.parse(await c.req.json());
    const approved = await stepUpGranted(c, current, 'sensitive_settings', {
      action: revokePasskey.operationId,
      targets: [passkeyId],
    });
    if (!approved) return fail(c, 'step_up_required', 403);
    const outcome = await devices.revokePasskey(current, passkeyId);
    if (outcome === 'not_found') return fail(c, 'not_found', 404);
    if (outcome === 'last_active') return fail(c, 'last_active_passkey', 409);
    if (outcome === 'recovery_pending') return fail(c, 'recovery_pending', 403);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.revokeOtherSessions, async (c) => {
    const current = await signedIn(c);
    if (current === null || devices === undefined) return unauthorized(c);
    const approved = await stepUpGranted(c, current, 'sensitive_settings', {
      action: revokeOtherSessions.operationId,
      targets: [],
    });
    if (!approved) return fail(c, 'step_up_required', 403);
    await devices.revokeOtherSessions(current);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.addPasskeyOptions, async (c) => {
    const current = await signedIn(c);
    if (current === null || devices === undefined) return unauthorized(c);
    const approved = await stepUpGranted(c, current, 'sensitive_settings', {
      action: addPasskeyOptions.operationId,
      targets: [],
    });
    if (!approved) return fail(c, 'step_up_required', 403);
    return c.json(await devices.addOptions(current), 200);
  });

  v1.openapi(openApiRoutes.addPasskey, async (c) => {
    const current = await signedIn(c);
    if (current === null || devices === undefined || authLimits === undefined) {
      return unauthorized(c);
    }
    const limited = await overLimit(c, authLimits, deviceLimits.addPasskey, current.sessionId);
    if (limited !== undefined) return limited;
    const { challengeId, response } = addPasskey.body.parse(await c.req.json());
    if (!(await devices.add(current, challengeId, response))) {
      return fail(c, 'passkey_refused', 403);
    }
    return c.json({}, 200);
  });

  // Recovery comes before any session (spec 0003, R6), so its routes are limited per address.
  v1.openapi(openApiRoutes.recoveryStart, async (c) => {
    if (recovery === undefined || authLimits === undefined) return fail(c, 'not_found', 404);
    const limited = await overAddressLimit(c, authLimits, recoveryLimits.startIp);
    if (limited !== undefined) return limited;
    const { email } = recoveryStart.body.parse(await c.req.json());
    const perEmail = await overLimit(c, authLimits, recoveryLimits.startEmail, email.toLowerCase());
    if (perEmail !== undefined) return perEmail;
    if ((await recovery.start(email, behindAnswerOf(c.req.raw))) === 'email_unavailable') {
      return fail(c, 'email_unavailable', 503);
    }
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.recoveryRedeem, async (c) => {
    if (recovery === undefined || authLimits === undefined) return fail(c, 'not_found', 404);
    const limited = await overAddressLimit(c, authLimits, recoveryLimits.redeem);
    if (limited !== undefined) return limited;
    const { token, code } = recoveryRedeem.body.parse(await c.req.json());
    const outcome = await recovery.redeem(token, code);
    if (outcome.ok) return c.json({ code: outcome.code, token: outcome.token }, 200);
    if (outcome.reason === 'not_found') return fail(c, 'not_found', 404);
    return fail(c, outcome.reason === 'locked' ? 'recovery_locked' : 'invalid_code', 403);
  });

  v1.openapi(openApiRoutes.recoveryOptions, async (c) => {
    if (recovery === undefined || authLimits === undefined) return fail(c, 'not_found', 404);
    const limited = await overAddressLimit(c, authLimits, recoveryLimits.options);
    if (limited !== undefined) return limited;
    const { token } = recoveryOptions.body.parse(await c.req.json());
    const options = await recovery.options(token);
    return options === null ? fail(c, 'not_found', 404) : c.json(options, 200);
  });

  v1.openapi(openApiRoutes.recoveryVerify, async (c) => {
    if (recovery === undefined || authLimits === undefined) return fail(c, 'not_found', 404);
    const limited = await overAddressLimit(c, authLimits, recoveryLimits.verify);
    if (limited !== undefined) return limited;
    const { token, response } = recoveryVerify.body.parse(await c.req.json());
    const device = describeDevice(c.req.header('user-agent'));
    const outcome = await recovery.verify(token, response, device);
    if (outcome === 'not_found') return fail(c, 'not_found', 404);
    if (outcome === 'refused') return fail(c, 'passkey_refused', 403);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.auditEvents, async (c) => {
    const current = await signedIn(c);
    if (current === null || audit === undefined) return unauthorized(c);
    // The router has already answered 400 to an invalid query; parsed again for its type.
    const query = AuditEventsQuery.parse(c.req.query());
    return c.json(await audit.events(current.accountId, query), 200);
  });

  app.route(apiBasePath, v1);

  // Only allow-listed Better Auth endpoints reach it (spec 0003, R1). The match is on the exact
  // method and the raw path Better Auth will route on, so no encoding or extra segment slips by.
  const allowed = new Map<string, { route: RouteDefinition; limit: RateLimitRule }>(
    authRoutes.map((route) => [
      routeKey(route),
      { route, limit: authRouteLimits[route.operationId] },
    ]),
  );
  app.all(`${authBasePath}/*`, async (c) => {
    const match = allowed.get(`${c.req.method} ${new URL(c.req.url).pathname}`);
    if (auth === undefined || authLimits === undefined || match === undefined) {
      return reject(c, 'not_found', 404);
    }
    // Counted only for this site's own pages: a cross-site page loading the options URL (an
    // image tag needs no Origin) would otherwise spend the budget of everyone behind its NAT.
    // Clients that send no Sec-Fetch-Site, such as native apps, are counted as usual.
    const site = c.req.header('sec-fetch-site');
    if (site !== undefined && site !== 'same-origin') return reject(c, 'cross_origin', 403);
    const { route, limit } = match;
    const limited = await overLimit(
      c,
      authLimits,
      limit,
      authLimits.clientAddress(c.req.raw.headers),
    );
    if (limited !== undefined) return limited;
    if (route.body !== undefined && !route.body.safeParse(await bodyOf(c.req.raw)).success) {
      return reject(c, 'invalid_request', 400);
    }
    return throughContract(c, route, await auth.handle(c.req.raw));
  });

  app.get('/.well-known/security.txt', (c) =>
    c.text(securityTxt(), 200, { 'Cache-Control': 'public, max-age=86400' }),
  );

  if (outbox !== undefined) {
    app.get('/internal/outbox', async (c) => c.json({ messages: await outbox() }, 200));
  }

  // Vercel cron sends GET with `Authorization: Bearer <CRON_SECRET>` (spec 0001, R6). Not part of
  // the OpenAPI document, and the only route that starts a workflow.
  if (cron !== undefined) {
    const { readSecret, startHeartbeat, sweepRateLimits, clock = () => new Date() } = cron;
    const fromCron = createMiddleware<AppEnv>(async (c, next) => {
      if (!bearerMatches(c.req.header('authorization'), readSecret())) {
        return reject(c, 'unauthorized', 401);
      }
      return next();
    });
    app.get('/internal/cron/heartbeat', fromCron, async (c) => {
      await startHeartbeat(utcDate(clock()));
      return c.body(null, 202);
    });
    // A single idempotent delete, so it runs inline instead of as a workflow.
    app.get('/internal/cron/rate-limit-sweep', fromCron, async (c) => {
      await sweepRateLimits();
      return c.body(null, 204);
    });
  }
  return app;
}

export type App = ReturnType<typeof createApp>;
