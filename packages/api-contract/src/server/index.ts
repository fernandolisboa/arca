import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { z } from 'zod';
import { apiBasePath, ErrorResponse, routes, type RouteDefinition } from '../routes/index.js';

/** Wraps a plain route definition for @hono/zod-openapi; the error shape is shared by every route. */
export function toOpenApiRoute<Schema extends z.ZodType>(route: RouteDefinition<Schema>) {
  return createRoute({
    method: route.method,
    path: route.path,
    operationId: route.operationId,
    summary: route.summary,
    request: {
      ...(route.body === undefined
        ? {}
        : { body: { required: true, content: { 'application/json': { schema: route.body } } } }),
      ...(route.query === undefined ? {} : { query: route.query }),
    },
    responses: {
      200: {
        description: route.response.description,
        content: {
          'application/json': { schema: route.response.schema },
        },
      },
      default: {
        description: 'Error',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
}

export const openApiRoutes = {
  health: toOpenApiRoute(routes.health),
  session: toOpenApiRoute(routes.session),
  signOut: toOpenApiRoute(routes.signOut),
  passkeySignInOptions: toOpenApiRoute(routes.passkeySignInOptions),
  passkeySignIn: toOpenApiRoute(routes.passkeySignIn),
  auditEvents: toOpenApiRoute(routes.auditEvents),
} as const;

export const openApiInfo = { title: 'Arca API', version: '1.0.0' } as const;

export function buildOpenApiDocument(): ReturnType<OpenAPIHono['getOpenAPI31Document']> {
  const app = new OpenAPIHono();
  for (const route of Object.values(openApiRoutes)) app.openAPIRegistry.registerPath(route);
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: openApiInfo,
    servers: [{ url: apiBasePath }],
  });
}

export function serializeOpenApiDocument(): string {
  return `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
}
