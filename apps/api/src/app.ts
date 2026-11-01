import { OpenAPIHono } from '@hono/zod-openapi';
import { apiBasePath, type ErrorResponse } from '@arca/api-contract/routes';
import { openApiRoutes } from '@arca/api-contract/server';
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

interface Variables {
  requestId: string;
  errorCode?: string;
}

const noStorePrefixes = [apiBasePath, '/internal'] as const;
const databaseCacheMs = 10_000;

function errorBody(code: string): ErrorResponse {
  return { error: { code } };
}

/** The API as a plain Hono app, importable and testable without the Nitro shell. */
export function createApp({
  checkDatabase,
  logger,
  now = () => performance.now(),
  newRequestId = () => crypto.randomUUID(),
}: AppDependencies) {
  const app = new OpenAPIHono<{ Variables: Variables }>({
    defaultHook: (result, c) => {
      if (!result.success) {
        c.set('errorCode', 'invalid_request');
        return c.json(errorBody('invalid_request'), 400);
      }
      return undefined;
    },
  });

  const observe = createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const started = now();
    const requestId = newRequestId();
    c.set('requestId', requestId);
    await next();
    c.header('X-Request-Id', requestId);
    if (
      noStorePrefixes.some((prefix) => c.req.path === prefix || c.req.path.startsWith(`${prefix}/`))
    ) {
      c.header('Cache-Control', 'no-store');
    }
    const errorCode = c.get('errorCode');
    logger[c.res.status >= 500 ? 'error' : 'info']({
      requestId,
      method: c.req.method,
      route: routePath(c),
      status: c.res.status,
      durationMs: Math.round(now() - started),
      ...(errorCode === undefined ? {} : { errorCode }),
    });
  });
  app.use('*', observe);

  app.onError((error, c) => {
    const status: ContentfulStatusCode = error instanceof HTTPException ? error.status : 500;
    const code = status === 500 ? 'internal_error' : 'request_failed';
    c.set('errorCode', code);
    return c.json(errorBody(code), status);
  });

  app.notFound((c) => {
    c.set('errorCode', 'not_found');
    return c.json(errorBody('not_found'), 404);
  });

  const v1 = new OpenAPIHono<{ Variables: Variables }>();
  const databaseStatus = cachedDatabaseCheck(checkDatabase, { ttlMs: databaseCacheMs, now });

  v1.openapi(openApiRoutes.health, async (c) => {
    const database = await databaseStatus();
    return c.json({ status: database === 'ok' ? 'ok' : 'degraded', checks: { database } }, 200);
  });

  app.route(apiBasePath, v1);
  return app;
}

export type App = ReturnType<typeof createApp>;
