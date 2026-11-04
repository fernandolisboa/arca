import { OpenAPIHono } from '@hono/zod-openapi';
import {
  apiBasePath,
  AuditEventsQuery,
  authBasePath,
  authRoutes,
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
import { authRouteLimits, stepUpLimits } from './auth/limits.js';
import type { RateLimiter, RateLimitRule } from './auth/rate-limit.js';
import type { AuthService } from './auth/service.js';
import type { StepUpService } from './auth/step-up.js';
import type { OutboxEntry } from './email/outbox.js';
import { bearerMatches } from './cron-auth.js';
import { cachedDatabaseCheck, type CheckDatabase } from './database-health.js';
import type { Logger } from './logger.js';
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
  /** Better Auth behind the allow-list; absent, every auth path is a 404. */
  readonly auth?: AuthService;
  readonly authLimits?: AuthLimits;
  /** Purpose-bound step-up (spec 0003, R5); absent, its routes answer 401. */
  readonly stepUp?: StepUpService;
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
  | 'request_failed'
  | 'internal_error';

export interface AppEnv {
  Variables: {
    requestId: string;
    errorCode?: ErrorCode;
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

/** The API as a plain Hono app, importable and testable without the Nitro shell. */
export function createApp({
  checkDatabase,
  logger,
  now = () => performance.now(),
  newRequestId = () => crypto.randomUUID(),
  cron,
  origin,
  auth,
  authLimits,
  stepUp,
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
    return c.json({ status: database === 'ok' ? 'ok' : 'degraded', checks: { database } }, 200);
  });

  const signedIn = (c: Context<AppEnv>) =>
    auth === undefined ? Promise.resolve(null) : auth.signedIn(c.req.raw.headers);
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
  const unauthorized = (c: Context<AppEnv>) => {
    c.set('errorCode', 'unauthorized');
    return c.json({ error: { code: 'unauthorized' } } satisfies ErrorResponse, 401);
  };

  v1.openapi(openApiRoutes.session, async (c) => {
    if (auth === undefined) return unauthorized(c);
    const { session, setCookies } = await auth.refresh(c.req.raw.headers);
    for (const cookie of setCookies) c.header('set-cookie', cookie, { append: true });
    return session === null ? unauthorized(c) : c.json(session, 200);
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
      c.set('errorCode', 'step_up_refused');
      return c.json({ error: { code: 'step_up_refused' } } satisfies ErrorResponse, 403);
    }
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
      `${route.method.toUpperCase()} ${apiBasePath}${route.path}`,
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
