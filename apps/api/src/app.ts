import { OpenAPIHono } from '@hono/zod-openapi';
import {
  apiBasePath,
  AuditEventsQuery,
  authBasePath,
  authRoutes,
  type ErrorResponse,
} from '@arca/api-contract/routes';
import { openApiRoutes } from '@arca/api-contract/server';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createMiddleware } from 'hono/factory';
import { routePath } from 'hono/route';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AuditReader } from './audit/log.js';
import type { AuthService } from './auth/service.js';
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
  readonly clock?: () => Date;
}

export interface AppDependencies {
  readonly checkDatabase: CheckDatabase;
  readonly logger: Logger;
  /** Monotonic milliseconds, for durations and the health cache. */
  readonly now?: () => number;
  readonly newRequestId?: () => string;
  readonly cron?: CronDependencies;
  /** Better Auth behind the allow-list; absent, every auth path is a 404. */
  readonly auth?: AuthService;
  /** The signed-in account's audit events; absent, the route answers 401. */
  readonly audit?: AuditReader;
  /**
   * The outbox's messages, given only on preview deployments, which Vercel Deployment
   * Protection keeps private (spec 0003, R8); absent, `/internal/outbox` is a 404.
   */
  readonly outbox?: () => Promise<readonly OutboxEntry[]>;
}

export type ErrorCode =
  'invalid_request' | 'unauthorized' | 'not_found' | 'request_failed' | 'internal_error';

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
  auth,
  audit,
  outbox,
}: AppDependencies) {
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
    auth === undefined ? Promise.resolve(null) : auth.session(c.req.raw.headers);
  const unauthorized = (c: Context<AppEnv>) => {
    c.set('errorCode', 'unauthorized');
    return c.json({ error: { code: 'unauthorized' } } satisfies ErrorResponse, 401);
  };

  v1.openapi(openApiRoutes.session, async (c) => {
    const current = await signedIn(c);
    return current === null ? unauthorized(c) : c.json(current, 200);
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
  const allowed = new Set(
    authRoutes.map((route) => `${route.method.toUpperCase()} ${apiBasePath}${route.path}`),
  );
  app.all(`${authBasePath}/*`, async (c) => {
    const key = `${c.req.method} ${new URL(c.req.url).pathname}`;
    if (auth === undefined || !allowed.has(key)) return reject(c, 'not_found', 404);
    return auth.handle(c.req.raw);
  });

  if (outbox !== undefined) {
    app.get('/internal/outbox', async (c) => c.json({ messages: await outbox() }, 200));
  }

  // Vercel cron sends GET with `Authorization: Bearer <CRON_SECRET>` (spec 0001, R6). Not part of
  // the OpenAPI document, and the only route that starts a workflow.
  if (cron !== undefined) {
    const { readSecret, startHeartbeat, clock = () => new Date() } = cron;
    app.get('/internal/cron/heartbeat', async (c) => {
      if (!bearerMatches(c.req.header('authorization'), readSecret())) {
        return reject(c, 'unauthorized', 401);
      }
      await startHeartbeat(utcDate(clock()));
      return c.body(null, 202);
    });
  }
  return app;
}

export type App = ReturnType<typeof createApp>;
