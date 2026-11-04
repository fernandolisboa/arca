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
  /** False until the inviter confirms the account, which stays restricted until then (spec 0003, R2). */
  confirmed: z.boolean(),
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

const base64url = z.string().regex(/^[A-Za-z0-9_-]*$/);

/**
 * WebAuthn request options as JSON (spec 0003, R3): discoverable credentials, so usually no
 * `allowCredentials`, and user verification always required.
 */
export const PasskeyRequestOptions = z.object({
  challenge: base64url,
  timeout: z.number().int().positive().optional(),
  rpId: z.string().optional(),
  allowCredentials: z
    .array(
      z.object({
        id: base64url,
        type: z.literal('public-key'),
        transports: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  userVerification: z.literal('required'),
  extensions: z.record(z.string(), z.unknown()).optional(),
});
export type PasskeyRequestOptions = z.infer<typeof PasskeyRequestOptions>;

export const passkeySignInOptions = {
  method: 'get',
  path: '/auth/passkey/generate-authenticate-options',
  operationId: 'passkeySignInOptions',
  summary: 'Options for a passkey sign-in, with a single-use challenge in a cookie',
  response: { description: 'Request options', schema: PasskeyRequestOptions },
} as const satisfies RouteDefinition<typeof PasskeyRequestOptions>;

/** A WebAuthn assertion as JSON, as the Passkeys port returns it. */
export const PasskeyAssertion = z.object({
  id: base64url,
  rawId: base64url,
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: base64url,
    authenticatorData: base64url,
    signature: base64url,
    userHandle: base64url.optional(),
  }),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()),
});
export type PasskeyAssertion = z.infer<typeof PasskeyAssertion>;

/** Nothing but success: the session travels only in its cookie, never in a body. */
export const PasskeySignInResponse = z.object({});
export type PasskeySignInResponse = z.infer<typeof PasskeySignInResponse>;

export const passkeySignIn = {
  method: 'post',
  path: '/auth/passkey/verify-authentication',
  operationId: 'passkeySignIn',
  summary: 'Signs in with a passkey assertion and sets the session cookie',
  body: z.object({ response: PasskeyAssertion }),
  response: { description: 'Signed in', schema: PasskeySignInResponse },
} as const satisfies RouteDefinition<typeof PasskeySignInResponse>;

/** Closed purpose enum of a step-up (spec 0003, R5). */
export const stepUpPurposes = [
  'sensitive_settings',
  'account_deletion',
  'data_export',
  'financial_action',
  'vault_unlock',
  'vault_write',
] as const;

export const StepUpPurpose = z.enum(stepUpPurposes);
export type StepUpPurpose = z.infer<typeof StepUpPurpose>;

const identifierPattern = /^[a-z][A-Za-z0-9]{0,63}$/;
const maxActionFields = 16;

/**
 * The action a step-up approves (spec 0003, R5), from which the server computes the subject
 * hash: the route's operation ID, the IDs it acts on in order, its security-relevant body fields
 * (such as new bank details or an amount) as strings, and a 128-bit nonce the client draws and
 * sends again with the action itself. Each guarded route defines its own in this contract.
 */
export const StepUpAction = z.strictObject({
  action: z.string().regex(identifierPattern),
  targets: z.array(z.string().min(1).max(128)).max(32),
  fields: z
    .record(z.string().regex(identifierPattern), z.string().max(4096))
    .refine((fields) => Object.keys(fields).length <= maxActionFields)
    .optional(),
  /** 16 random bytes, base64url without padding. */
  nonce: z.string().regex(/^[A-Za-z0-9_-]{21}[AQgw]$/),
});
export type StepUpAction = z.infer<typeof StepUpAction>;

/** The header a guarded route reads the action's nonce from. */
export const stepUpNonceHeader = 'arca-step-up-nonce';

/** `vault_unlock` approves a window, not an action, so it alone carries no target. */
export const StepUpOptionsRequest = z.union([
  z.strictObject({ purpose: z.literal('vault_unlock') }),
  z.strictObject({
    purpose: StepUpPurpose.exclude(['vault_unlock']),
    target: StepUpAction,
  }),
]);
export type StepUpOptionsRequest = z.infer<typeof StepUpOptionsRequest>;

export const StepUpOptionsResponse = z.object({
  challengeId: z.uuid(),
  options: PasskeyRequestOptions,
});
export type StepUpOptionsResponse = z.infer<typeof StepUpOptionsResponse>;

export const stepUpOptions = {
  method: 'post',
  path: '/auth/step-up/options',
  operationId: 'stepUpOptions',
  summary: 'Options for a step-up bound to a purpose and an action, valid for 2 minutes',
  body: StepUpOptionsRequest,
  response: { description: 'Request options and their challenge', schema: StepUpOptionsResponse },
} as const satisfies RouteDefinition<typeof StepUpOptionsResponse>;

export const StepUpVerifyResponse = z.object({});
export type StepUpVerifyResponse = z.infer<typeof StepUpVerifyResponse>;

export const stepUpVerify = {
  method: 'post',
  path: '/auth/step-up/verify',
  operationId: 'stepUpVerify',
  summary: 'Verifies a step-up assertion; the approved action may then run once',
  body: z.strictObject({ challengeId: z.uuid(), response: PasskeyAssertion }),
  response: { description: 'Step-up verified', schema: StepUpVerifyResponse },
} as const satisfies RouteDefinition<typeof StepUpVerifyResponse>;

/** A link token (enrollment, invite, recovery): 256 random bits, base64url without padding. */
const LinkToken = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);

export const EnrollOwnerRequest = z.strictObject({
  /** Typed by the owner; checked against the committed hash (spec 0003, R2). */
  code: z.string().min(1).max(64),
  email: z.email().max(254),
});
export type EnrollOwnerRequest = z.infer<typeof EnrollOwnerRequest>;

export const EnrollOwnerResponse = z.object({});
export type EnrollOwnerResponse = z.infer<typeof EnrollOwnerResponse>;

export const enrollOwner = {
  method: 'post',
  path: '/auth/enroll-owner',
  operationId: 'enrollOwner',
  summary:
    'Emails a registration link to the first account; 404 once an account exists or the code is not the configured one',
  body: EnrollOwnerRequest,
  response: { description: 'Link sent', schema: EnrollOwnerResponse },
} as const satisfies RouteDefinition<typeof EnrollOwnerResponse>;

/**
 * WebAuthn creation options as JSON (spec 0003, R3): a resident key and user verification are
 * required, and PRF is requested empty, only to learn whether the authenticator supports it.
 */
export const PasskeyCreationOptions = z.object({
  challenge: base64url,
  rp: z.object({ id: z.string().optional(), name: z.string() }),
  user: z.object({ id: base64url, name: z.string(), displayName: z.string() }),
  pubKeyCredParams: z.array(z.object({ type: z.literal('public-key'), alg: z.number().int() })),
  timeout: z.number().int().positive().optional(),
  excludeCredentials: z
    .array(
      z.object({
        id: base64url,
        type: z.literal('public-key'),
        transports: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  authenticatorSelection: z.object({
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
    residentKey: z.literal('required'),
    requireResidentKey: z.literal(true),
    userVerification: z.literal('required'),
  }),
  attestation: z.literal('none').optional(),
  extensions: z.strictObject({ prf: z.strictObject({}) }),
});
export type PasskeyCreationOptions = z.infer<typeof PasskeyCreationOptions>;

export const RegistrationOptionsRequest = z.strictObject({
  token: LinkToken,
  /** The enrollment code, for an owner link only; checked before the ceremony so a typo costs no passkey. */
  code: z.string().min(1).max(64).optional(),
});
export type RegistrationOptionsRequest = z.infer<typeof RegistrationOptionsRequest>;

export const registrationOptions = {
  method: 'post',
  path: '/auth/registration/options',
  operationId: 'registrationOptions',
  summary: "Options for registering a link's passkey, with a single-use challenge in a cookie",
  body: RegistrationOptionsRequest,
  response: { description: 'Creation options', schema: PasskeyCreationOptions },
} as const satisfies RouteDefinition<typeof PasskeyCreationOptions>;

/**
 * A WebAuthn attestation as JSON, as the Passkeys port returns it: among the extension results
 * only `prf.enabled`, never a PRF output (ADR-0018).
 */
export const PasskeyAttestation = z.object({
  id: base64url,
  rawId: base64url,
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: base64url,
    attestationObject: base64url,
    authenticatorData: base64url.optional(),
    transports: z.array(z.string()).optional(),
    publicKeyAlgorithm: z.number().int().optional(),
    publicKey: base64url.optional(),
  }),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: z.strictObject({
    prf: z.strictObject({ enabled: z.boolean() }).optional(),
  }),
});
export type PasskeyAttestation = z.infer<typeof PasskeyAttestation>;

export const RegistrationVerifyRequest = z.strictObject({
  token: LinkToken,
  code: z.string().min(1).max(64).optional(),
  response: PasskeyAttestation,
});
export type RegistrationVerifyRequest = z.infer<typeof RegistrationVerifyRequest>;

/** Nothing but success: the session travels only in its cookie. */
export const RegistrationVerifyResponse = z.object({});
export type RegistrationVerifyResponse = z.infer<typeof RegistrationVerifyResponse>;

export const registrationVerify = {
  method: 'post',
  path: '/auth/registration/verify',
  operationId: 'registrationVerify',
  summary: "Registers the link's passkey, creating its account and signing it in",
  body: RegistrationVerifyRequest,
  response: { description: 'Registered and signed in', schema: RegistrationVerifyResponse },
} as const satisfies RouteDefinition<typeof RegistrationVerifyResponse>;

export const RecoveryKitStatus = z.object({
  /** `unsaved` until the person confirms the kit was saved; it is never shown again after. */
  status: z.enum(['none', 'unsaved', 'saved']),
});
export type RecoveryKitStatus = z.infer<typeof RecoveryKitStatus>;

export const recoveryKitStatus = {
  method: 'get',
  path: '/account/recovery-kit',
  operationId: 'recoveryKitStatus',
  summary: "Whether the account's recovery kit exists and was saved; never the code",
  response: { description: 'Recovery kit status', schema: RecoveryKitStatus },
} as const satisfies RouteDefinition<typeof RecoveryKitStatus>;

export const RecoveryKit = z.object({
  /** 128 random bits in Crockford base32, shown once. */
  code: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
});
export type RecoveryKit = z.infer<typeof RecoveryKit>;

/**
 * The account's first kit needs nothing more than the session within a day of its creation;
 * replacing one needs a `sensitive_settings` step-up for this action with no targets, its nonce
 * in the `arca-step-up-nonce` header (spec 0003, R6).
 */
export const regenerateRecoveryKit = {
  method: 'post',
  path: '/account/recovery-kit',
  operationId: 'regenerateRecoveryKit',
  summary: 'Issues the account part of a new recovery kit; the previous code stops working',
  body: z.strictObject({}),
  response: { description: 'The new recovery code', schema: RecoveryKit },
} as const satisfies RouteDefinition<typeof RecoveryKit>;

export const RecoveryKitConfirmResponse = z.object({});
export type RecoveryKitConfirmResponse = z.infer<typeof RecoveryKitConfirmResponse>;

export const confirmRecoveryKit = {
  method: 'post',
  path: '/account/recovery-kit/confirm',
  operationId: 'confirmRecoveryKit',
  summary: 'Records that the person saved the recovery kit',
  body: z.strictObject({}),
  response: { description: 'Recorded', schema: RecoveryKitConfirmResponse },
} as const satisfies RouteDefinition<typeof RecoveryKitConfirmResponse>;

export const CreateInviteRequest = z.strictObject({ email: z.email().max(254) });
export type CreateInviteRequest = z.infer<typeof CreateInviteRequest>;

export const CreateInviteResponse = z.object({});
export type CreateInviteResponse = z.infer<typeof CreateInviteResponse>;

/** At most this many open invites per account (spec 0003, R2). */
export const maxOpenInvites = 10;

export const createInvite = {
  method: 'post',
  path: '/invites',
  operationId: 'createInvite',
  summary:
    'Emails an invite valid for 48 hours; 403 account_unconfirmed until the account is confirmed, 409 too_many_invites past 10 open',
  body: CreateInviteRequest,
  response: { description: 'Invite sent', schema: CreateInviteResponse },
} as const satisfies RouteDefinition<typeof CreateInviteResponse>;

export const Invite = z.object({
  id: z.uuid(),
  email: z.email(),
  /** `accepted` waits for the inviter to confirm or decline the new account. */
  status: z.enum(['open', 'accepted', 'confirmed']),
  createdAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type Invite = z.infer<typeof Invite>;

export const InvitesResponse = z.object({ invites: z.array(Invite) });
export type InvitesResponse = z.infer<typeof InvitesResponse>;

export const listInvites = {
  method: 'get',
  path: '/invites',
  operationId: 'listInvites',
  summary: "The signed-in account's open, accepted or confirmed invites, newest first",
  response: { description: 'Invites', schema: InvitesResponse },
} as const satisfies RouteDefinition<typeof InvitesResponse>;

export const InviteDetailsRequest = z.strictObject({ token: LinkToken });
export type InviteDetailsRequest = z.infer<typeof InviteDetailsRequest>;

export const InviteDetails = z.object({ inviterEmail: z.email() });
export type InviteDetails = z.infer<typeof InviteDetails>;

export const inviteDetails = {
  method: 'post',
  path: '/invites/details',
  operationId: 'inviteDetails',
  summary: 'Who sent an invite link, while it can still be accepted; 404 otherwise',
  body: InviteDetailsRequest,
  response: { description: 'The invite', schema: InviteDetails },
} as const satisfies RouteDefinition<typeof InviteDetails>;

export const InviteDecisionRequest = z.strictObject({ inviteId: z.uuid() });
export type InviteDecisionRequest = z.infer<typeof InviteDecisionRequest>;

export const InviteDecisionResponse = z.object({});
export type InviteDecisionResponse = z.infer<typeof InviteDecisionResponse>;

/**
 * Both decisions need a `sensitive_settings` step-up for their action with the invite as the only
 * target (spec 0003, R2); 404 unless the invite is the caller's and waits for a decision.
 */
export const confirmInvite = {
  method: 'post',
  path: '/invites/confirm',
  operationId: 'confirmInvite',
  summary: 'Confirms the account that accepted an invite, after a step-up',
  body: InviteDecisionRequest,
  response: { description: 'Confirmed', schema: InviteDecisionResponse },
} as const satisfies RouteDefinition<typeof InviteDecisionResponse>;

export const declineInvite = {
  method: 'post',
  path: '/invites/decline',
  operationId: 'declineInvite',
  summary: 'Erases the account that accepted an invite, after a step-up',
  body: InviteDecisionRequest,
  response: { description: 'Declined', schema: InviteDecisionResponse },
} as const satisfies RouteDefinition<typeof InviteDecisionResponse>;

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
  limit: z.coerce.number<number>().int().min(1).max(100).optional(),
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

export const routes = {
  health,
  session,
  signOut,
  passkeySignInOptions,
  passkeySignIn,
  stepUpOptions,
  stepUpVerify,
  enrollOwner,
  registrationOptions,
  registrationVerify,
  recoveryKitStatus,
  regenerateRecoveryKit,
  confirmRecoveryKit,
  createInvite,
  listInvites,
  inviteDetails,
  confirmInvite,
  declineInvite,
  auditEvents,
} as const;

/** The Better Auth endpoints the API lets through; every other path under /v1/auth is a 404. */
export const authRoutes = [signOut, passkeySignInOptions, passkeySignIn] as const;
