import { z } from 'zod';

/** Every route lives under this prefix; clients prepend their origin, if any. */
export const apiBasePath = '/v1';

/** Error bodies carry a machine code only; details stay in the server log (spec 0001, R3). */
export const ErrorResponse = z.object({
  error: z.object({ code: z.string().regex(/^[a-z_]{1,64}$/) }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/** Route metadata as plain data, shared by the server bindings, the OpenAPI export and the client. */
export interface RouteDefinition<Response extends z.ZodType = z.ZodType> {
  readonly method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Path relative to {@link apiBasePath}. */
  readonly path: `/${string}`;
  readonly operationId: string;
  readonly summary: string;
  readonly response: { readonly description: string; readonly schema: Response };
}

export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({
    database: z.enum(['ok', 'unavailable', 'wrong_role']),
  }),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const health = {
  method: 'get',
  path: '/health',
  operationId: 'getHealth',
  summary: 'Service health, including the database connection and its role',
  response: { description: 'Current health', schema: HealthResponse },
} as const satisfies RouteDefinition<typeof HealthResponse>;

export const routes = { health } as const;
