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
  /** Query parameters, for routes that take them; never personal data (spec 0001, R3). */
  readonly query?: z.ZodObject;
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

/** Closed purpose enum of a step-up (spec 0003, R5). */
export const stepUpPurposes = [
  'sensitive_settings',
  'account_deletion',
  'data_export',
  'financial_action',
  'vault_unlock',
  'vault_write',
] as const;

const passkeyEvent = z.strictObject({ passkeyId: z.uuid() });
const inviteEvent = z.strictObject({ inviteId: z.uuid() });
const noDetails = z.strictObject({});

/**
 * The closed list of audit event codes and, for each, the only `details` keys it may carry:
 * identifiers and enum values, never personal data (spec 0003, R7). The server validates every
 * event against it before inserting.
 */
export const auditEventDetails = {
  sign_in: z.strictObject({
    passkeyId: z.uuid().optional(),
    browser: z.enum(browserFamilies),
    os: z.enum(osFamilies),
  }),
  sign_in_failed: z.strictObject({ passkeyId: z.uuid().optional() }),
  passkey_added: passkeyEvent,
  passkey_activated: passkeyEvent,
  passkey_revoked: passkeyEvent,
  session_revoked: z.strictObject({ sessionId: z.uuid() }),
  step_up_verified: z.strictObject({ purpose: z.enum(stepUpPurposes) }),
  invite_created: inviteEvent,
  invite_accepted: inviteEvent,
  invite_confirmed: inviteEvent,
  invite_declined: inviteEvent,
  invite_expired: inviteEvent,
  owner_enrolled: noDetails,
  recovery_started: noDetails,
  recovery_failed: noDetails,
  recovery_completed: noDetails,
  recovery_cancelled: noDetails,
  recovery_kit_regenerated: noDetails,
} as const;

export type AuditEventCode = keyof typeof auditEventDetails;
export type AuditEventDetails<Code extends AuditEventCode> = z.infer<
  (typeof auditEventDetails)[Code]
>;

const auditEventCodes = Object.keys(auditEventDetails) as [AuditEventCode, ...AuditEventCode[]];

export const AuditEvent = z.object({
  id: z.uuid(),
  time: z.iso.datetime({ offset: true }),
  code: z.enum(auditEventCodes),
  /** Null when the system acted, for example an expiry. */
  actorAccountId: z.uuid().nullable(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

export const AuditEventsQuery = z.object({
  /** The last event of the previous page. */
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type AuditEventsQuery = z.infer<typeof AuditEventsQuery>;

export const AuditEventsResponse = z.object({
  events: z.array(AuditEvent),
  /** Pass as `before` for the next page; null on the last page. */
  next: z.uuid().nullable(),
});
export type AuditEventsResponse = z.infer<typeof AuditEventsResponse>;

export const auditEvents = {
  method: 'get',
  path: '/audit/events',
  operationId: 'listAuditEvents',
  summary: "The signed-in account's audit events, newest first; 401 without a session",
  query: AuditEventsQuery,
  response: { description: 'A page of audit events', schema: AuditEventsResponse },
} as const satisfies RouteDefinition<typeof AuditEventsResponse>;

export const routes = { health, session, signOut, auditEvents } as const;

/** The Better Auth endpoints the API lets through; every other path under /v1/auth is a 404. */
export const authRoutes = [signOut] as const;
