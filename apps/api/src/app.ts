import { OpenAPIHono } from '@hono/zod-openapi';
import { apiBasePath, type ErrorResponse } from '@arca/api-contract/routes';
import { openApiRoutes } from '@arca/api-contract/server';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createMiddleware } from 'hono/factory';
import { routePath } from 'hono/route';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { cachedDatabaseCheck, type CheckDatabase } from './database-health.js';
import type { Logger } from './logger.js';

export interface AppDependencies {
  readonly checkDatabase: CheckDatabase;
  readonly logger: Logger;
  /** Monotonic milliseconds, for durations and the health cache. */
  readonly now?: () => number;
  readonly newRequestId?: () => string;
}

export type ErrorCode = 'invalid_request' | 'not_found' | 'request_failed' | 'internal_error';

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

  app.route(apiBasePath, v1);
  return app;
}

export type App = ReturnType<typeof createApp>;
