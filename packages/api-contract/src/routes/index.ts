import { z } from 'zod';

/** Every route lives under this prefix; clients prepend their origin, if any. */
export const apiBasePath = '/v1';

/** Better Auth's routes; only the allow-listed ones below are reachable (spec 0003, R1). */
export const authBasePath = `${apiBasePath}/auth` as const;

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
  /** A JSON request body, for routes that take one. */
  readonly body?: z.ZodType;
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

/** Closed enums for the device a session runs on, rendered through i18n (spec 0003, R4). */
export const browserFamilies = [
  'edge',
  'samsung_internet',
  'opera',
  'firefox',
  'chrome',
  'safari',
  'other',
] as const;
export const osFamilies = [
  'ios',
  'ipados',
  'android',
  'chromeos',
  'windows',
  'macos',
  'linux',
  'other',
] as const;

export const DeviceDescription = z.object({
  browser: z.enum(browserFamilies),
  os: z.enum(osFamilies),
});
export type DeviceDescription = z.infer<typeof DeviceDescription>;

export const SessionResponse = z.object({
  accountId: z.uuid(),
  email: z.email(),
  device: DeviceDescription,
});
export type SessionResponse = z.infer<typeof SessionResponse>;

export const session = {
  method: 'get',
  path: '/session',
  operationId: 'getSession',
  summary: 'The signed-in account and the device of this session; 401 without a session',
  response: { description: 'The current session', schema: SessionResponse },
} as const satisfies RouteDefinition<typeof SessionResponse>;

export const SignOutResponse = z.object({ success: z.boolean() });
export type SignOutResponse = z.infer<typeof SignOutResponse>;

/** Better Auth's endpoint, reachable because it is on the allow-list. */
export const signOut = {
  method: 'post',
  path: '/auth/sign-out',
  operationId: 'signOut',
  summary: 'Ends this session and clears its cookies',
  body: z.object({}),
  response: { description: 'Signed out', schema: SignOutResponse },
} as const satisfies RouteDefinition<typeof SignOutResponse>;

export const routes = { health, session, signOut } as const;

/** The Better Auth endpoints the API lets through; every other path under /v1/auth is a 404. */
export const authRoutes = [signOut] as const;
