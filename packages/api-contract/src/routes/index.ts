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
  /**
   * Whether new accounts can be made here: closed in a production with no sending domain yet,
   * where enrollment, invites, registration and recovery answer 503 accounts_closed (spec 0003, R9).
   */
  accounts: z.enum(['open', 'closed']),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const health = {
  method: 'get',
  path: '/health',
  operationId: 'getHealth',
  summary:
    'Service health, including the database connection and its role, and whether new accounts can be made',
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
  /**
   * When the account's newest pending passkey becomes active, while one is pending; every
   * session shows it (spec 0003, R4). Null otherwise.
   */
  pendingPasskeyUntil: z.iso.datetime({ offset: true }).nullable(),
  /**
   * A recovery passkey is pending: until it activates, this session may only show so and cancel
   * it from the device list (spec 0003, R6); every other route answers 403 recovery_pending.
   */
  recoveryPending: z.boolean(),
  /**
   * When the account is erased, while its deletion waits (spec 0004, R9): until then this session
   * may only show so and cancel it; every other route answers 403 deletion_pending. Null otherwise.
   */
  deletionDueAt: z.iso.datetime({ offset: true }).nullable(),
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
  summary:
    "Options for registering a link's passkey, with a single-use challenge in a cookie; 409 signed_in while a session exists",
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

export const RecoveryStartRequest = z.strictObject({ email: z.email().max(254) });
export type RecoveryStartRequest = z.infer<typeof RecoveryStartRequest>;

export const RecoveryStartResponse = z.object({});
export type RecoveryStartResponse = z.infer<typeof RecoveryStartResponse>;

/** How long a recovery link and the registration context it becomes stay valid (spec 0003, R6). */
export const recoveryLinkMinutes = 30;

/**
 * Recovery (spec 0003, R6): the same answer whether or not the address has an account, so it
 * says nothing about who uses Arca; a link is emailed only when recovery is open for the account.
 */
export const recoveryStart = {
  method: 'post',
  path: '/auth/recovery/start',
  operationId: 'recoveryStart',
  summary:
    'Emails a recovery link when the address has an account open to recovery; the same answer either way; 503 accounts_closed where no email can be sent',
  body: RecoveryStartRequest,
  response: { description: 'Accepted', schema: RecoveryStartResponse },
} as const satisfies RouteDefinition<typeof RecoveryStartResponse>;

export const RecoveryRedeemRequest = z.strictObject({
  token: LinkToken,
  /** As typed: spaces, hyphens and case are normalized on the server. */
  code: z.string().min(1).max(64),
});
export type RecoveryRedeemRequest = z.infer<typeof RecoveryRedeemRequest>;

export const RecoveryRedeemResponse = RecoveryKit.extend({
  /** The registration's own token, which replaces the emailed link's: the link no longer works. */
  token: LinkToken,
});
export type RecoveryRedeemResponse = z.infer<typeof RecoveryRedeemResponse>;

/**
 * Spends the recovery code and answers the new one at once, before the passkey ceremony, with
 * the registration token that replaces the link's until the link expires.
 */
export const recoveryRedeem = {
  method: 'post',
  path: '/auth/recovery/redeem',
  operationId: 'recoveryRedeem',
  summary:
    'Exchanges the recovery code for a new one and opens the registration; 404 to a dead link, 403 invalid_code or recovery_locked',
  body: RecoveryRedeemRequest,
  response: {
    description: 'The new recovery code and the registration token',
    schema: RecoveryRedeemResponse,
  },
} as const satisfies RouteDefinition<typeof RecoveryRedeemResponse>;

export const RecoveryOptionsRequest = z.strictObject({ token: LinkToken });
export type RecoveryOptionsRequest = z.infer<typeof RecoveryOptionsRequest>;

export const recoveryOptions = {
  method: 'post',
  path: '/auth/recovery/options',
  operationId: 'recoveryOptions',
  summary:
    'Creation options for the recovery passkey of a redeemed link, with a 2-minute challenge; 404 to a link that is not redeemed or is dead',
  body: RecoveryOptionsRequest,
  response: { description: 'Creation options', schema: PasskeyCreationOptions },
} as const satisfies RouteDefinition<typeof PasskeyCreationOptions>;

export const RecoveryVerifyRequest = z.strictObject({
  token: LinkToken,
  response: PasskeyAttestation,
});
export type RecoveryVerifyRequest = z.infer<typeof RecoveryVerifyRequest>;

export const RecoveryVerifyResponse = z.object({});
export type RecoveryVerifyResponse = z.infer<typeof RecoveryVerifyResponse>;

export const recoveryVerify = {
  method: 'post',
  path: '/auth/recovery/verify',
  operationId: 'recoveryVerify',
  summary:
    'Stores the recovery passkey, pending for 24 hours, and restricts every session of the account meanwhile; no session comes from it; 403 passkey_refused, 404 to a dead link',
  body: RecoveryVerifyRequest,
  response: { description: 'Registered', schema: RecoveryVerifyResponse },
} as const satisfies RouteDefinition<typeof RecoveryVerifyResponse>;

export const CreateInviteRequest = z.strictObject({ email: z.email().max(254) });
export type CreateInviteRequest = z.infer<typeof CreateInviteRequest>;

export const CreateInviteResponse = z.object({});
export type CreateInviteResponse = z.infer<typeof CreateInviteResponse>;

/** At most this many open invites per account (spec 0003, R2). */
export const maxOpenInvites = 10;
/** How long an invite can be accepted; the database default on `auth.invite` matches it. */
export const inviteLifetimeHours = 48;
/** How long an added passkey waits before it can sign in or approve a step-up (spec 0003, R4). */
export const pendingPasskeyHours = 24;

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

/** A live session as the device list shows it (spec 0003, R4). */
export const DeviceSession = z.object({
  id: z.uuid(),
  device: DeviceDescription,
  createdAt: z.iso.datetime({ offset: true }),
  /** When the session was last slid, at most once a day. */
  lastUsedAt: z.iso.datetime({ offset: true }),
  /** The session making this request. */
  current: z.boolean(),
});
export type DeviceSession = z.infer<typeof DeviceSession>;

export const DevicePasskey = z.object({
  id: z.uuid(),
  /** Null only for a passkey stored without the time, which the passkey plugin never does. */
  createdAt: z.iso.datetime({ offset: true }).nullable(),
  /** Whether it signed in the session making this request. */
  current: z.boolean(),
  /** A passkey added to the account cannot sign in or approve a step-up for 24 hours. */
  state: z.enum(['active', 'pending']),
  /** When a pending passkey becomes active; null once it is. */
  activeFrom: z.iso.datetime({ offset: true }).nullable(),
  /** A recovery's passkey, waiting: while it does, cancelling it is all a session may do (R6). */
  recovery: z.boolean(),
  sessions: z.array(DeviceSession),
});
export type DevicePasskey = z.infer<typeof DevicePasskey>;

export const DevicesResponse = z.object({ passkeys: z.array(DevicePasskey) });
export type DevicesResponse = z.infer<typeof DevicesResponse>;

export const listDevices = {
  method: 'get',
  path: '/devices',
  operationId: 'listDevices',
  summary:
    "The signed-in account's passkeys, oldest first, each with the live sessions it signed in; 401 without a session",
  response: { description: 'Passkeys and sessions', schema: DevicesResponse },
} as const satisfies RouteDefinition<typeof DevicesResponse>;

export const RevokeSessionRequest = z.strictObject({ sessionId: z.uuid() });
export type RevokeSessionRequest = z.infer<typeof RevokeSessionRequest>;

export const RevokePasskeyRequest = z.strictObject({ passkeyId: z.uuid() });
export type RevokePasskeyRequest = z.infer<typeof RevokePasskeyRequest>;

export const RevokeResponse = z.object({});
export type RevokeResponse = z.infer<typeof RevokeResponse>;

/**
 * Each revocation needs a `sensitive_settings` step-up for its own action, with the session or
 * the passkey as the only target, or none for the other sessions (spec 0003, R4).
 */
export const revokeSession = {
  method: 'post',
  path: '/devices/sessions/revoke',
  operationId: 'revokeSession',
  summary:
    "Ends one of the account's sessions, after a step-up; 403 step_up_required, 404 not_found",
  body: RevokeSessionRequest,
  response: { description: 'Revoked', schema: RevokeResponse },
} as const satisfies RouteDefinition<typeof RevokeResponse>;

export const revokePasskey = {
  method: 'post',
  path: '/devices/passkeys/revoke',
  operationId: 'revokePasskey',
  summary:
    "Removes one of the account's passkeys, or cancels a pending one, and ends every session it signed in, after a step-up; 403 step_up_required, 403 recovery_pending to any other passkey while a recovery passkey waits, 404 not_found, 409 last_active_passkey",
  body: RevokePasskeyRequest,
  response: { description: 'Revoked', schema: RevokeResponse },
} as const satisfies RouteDefinition<typeof RevokeResponse>;

export const revokeOtherSessions = {
  method: 'post',
  path: '/devices/sessions/revoke-others',
  operationId: 'revokeOtherSessions',
  summary: 'Ends every session of the account but this one, after a step-up; 403 step_up_required',
  body: z.strictObject({}),
  response: { description: 'Revoked', schema: RevokeResponse },
} as const satisfies RouteDefinition<typeof RevokeResponse>;

export const AddPasskeyOptionsResponse = z.object({
  challengeId: z.uuid(),
  options: PasskeyCreationOptions,
});
export type AddPasskeyOptionsResponse = z.infer<typeof AddPasskeyOptionsResponse>;

/**
 * Adding a passkey to the signed-in account (spec 0003, R4): the options need a
 * `sensitive_settings` step-up for this operation with no target, and the challenge is bound to
 * the session for 2 minutes.
 */
export const addPasskeyOptions = {
  method: 'post',
  path: '/devices/passkeys/options',
  operationId: 'addPasskeyOptions',
  summary:
    'Creation options for another passkey of the account, after a step-up; 403 step_up_required',
  body: z.strictObject({}),
  response: {
    description: 'Creation options and their challenge',
    schema: AddPasskeyOptionsResponse,
  },
} as const satisfies RouteDefinition<typeof AddPasskeyOptionsResponse>;

export const AddPasskeyRequest = z.strictObject({
  challengeId: z.uuid(),
  response: PasskeyAttestation,
});
export type AddPasskeyRequest = z.infer<typeof AddPasskeyRequest>;

export const AddPasskeyResponse = z.object({});
export type AddPasskeyResponse = z.infer<typeof AddPasskeyResponse>;

export const addPasskey = {
  method: 'post',
  path: '/devices/passkeys/add',
  operationId: 'addPasskey',
  summary:
    'Stores the new passkey, pending for 24 hours; no session comes from it; 403 passkey_refused for every refusal',
  body: AddPasskeyRequest,
  response: { description: 'Added', schema: AddPasskeyResponse },
} as const satisfies RouteDefinition<typeof AddPasskeyResponse>;

const passkeyEvent = z.strictObject({ passkeyId: z.uuid() });
const inviteEvent = z.strictObject({ inviteId: z.uuid() });
const noDetails = z.strictObject({});

/**
 * Why an account waits for erasure (spec 0004, R9 and R10): its owner asked, it went 3 years
 * without a sign-in, or it was an invited account its inviter declined or never confirmed.
 */
export const deletionReasons = [
  'owner_request',
  'inactivity',
  'invite_declined',
  'invite_unconfirmed',
] as const;
export type DeletionReason = (typeof deletionReasons)[number];

/**
 * The closed list of audit event codes and, for each, the only `details` keys it may carry:
 * identifiers and enum values, never personal data (spec 0003, R7). The server validates every
 * event against it before inserting.
 */
const documentEvent = z.strictObject({ documentId: z.uuid() });
const documentShareEvent = z.strictObject({ documentId: z.uuid(), recipientId: z.uuid() });

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
  data_exported: noDetails,
  deletion_requested: z.strictObject({ reason: z.enum(deletionReasons) }),
  deletion_cancelled: z.strictObject({ reason: z.enum(['owner_cancel', 'sign_in']) }),
  account_erased: noDetails,
  vault_created: noDetails,
  vault_envelopes_fetched: noDetails,
  vault_identity_rotated: noDetails,
  vault_recovery_resealed: noDetails,
  vault_reset: noDetails,
  document_created: documentEvent,
  document_download_url_issued: documentEvent,
  document_replaced: documentEvent,
  document_deleted: documentEvent,
  document_shared: documentShareEvent,
  document_share_revoked: documentShareEvent,
  notification_channel_added: z.strictObject({ channelId: z.uuid() }),
  notification_channel_removed: z.strictObject({ channelId: z.uuid() }),
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

/** The export's own format; a change that is not additive moves it to the next version. */
export const dataExportSchemaVersion = 1;

/** A value as the database holds it, or a fixed placeholder where the export masks one. */
const ExportedValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * Everything the account owns, one entry per registry table (spec 0004, R8): its rows through the
 * registry's projection, keyed by column name, and a label in the account's language.
 */
export const DataExport = z.object({
  schemaVersion: z.literal(dataExportSchemaVersion),
  exportedAt: z.iso.datetime({ offset: true }),
  tables: z.array(
    z.object({
      table: z.string(),
      label: z.string(),
      rows: z.array(z.record(z.string(), ExportedValue)),
    }),
  ),
});
export type DataExport = z.infer<typeof DataExport>;

export const exportAccountData = {
  method: 'post',
  path: '/account/export',
  operationId: 'exportAccountData',
  summary:
    'Downloads everything the account owns as one JSON document, after a data_export step-up; 403 step_up_required',
  body: z.strictObject({}),
  response: { description: 'The export, as an attachment', schema: DataExport },
} as const satisfies RouteDefinition<typeof DataExport>;

/** Days between a deletion request and the erasure, while it can be cancelled (spec 0004, R9). */
export const deletionWaitDays = 7;

export const AccountDeletionResponse = z.object({
  dueAt: z.iso.datetime({ offset: true }),
});
export type AccountDeletionResponse = z.infer<typeof AccountDeletionResponse>;

export const requestAccountDeletion = {
  method: 'post',
  path: '/account/deletion',
  operationId: 'requestAccountDeletion',
  summary:
    'Ends every session and erases the account after the wait, after an account_deletion step-up; 403 step_up_required',
  body: z.strictObject({}),
  response: { description: 'Deletion requested', schema: AccountDeletionResponse },
} as const satisfies RouteDefinition<typeof AccountDeletionResponse>;

export const CancelAccountDeletionResponse = z.object({});

export const cancelAccountDeletion = {
  method: 'delete',
  path: '/account/deletion',
  operationId: 'cancelAccountDeletion',
  summary:
    'Keeps the account whose deletion waits, after an account_deletion step-up; 403 step_up_required, 404 not_found',
  body: z.strictObject({}),
  response: { description: 'Deletion cancelled', schema: CancelAccountDeletionResponse },
} as const satisfies RouteDefinition<typeof CancelAccountDeletionResponse>;

/** An age file as the vault stores it, base64url in JSON: 64 to 16384 bytes (spec 0005, R2). */
export const VaultCiphertext = z.base64url().min(86).max(21846);

/** A WebAuthn credential ID, base64url, as the passkey plugin stores it. */
export const CredentialId = z.string().regex(/^[A-Za-z0-9_-]{16,1366}$/);

/** A hybrid post-quantum age recipient (ADR-0018). */
export const VaultRecipient = z
  .string()
  .max(2100)
  .regex(/^age1pq1[02-9ac-hj-np-z]+$/);

export const VaultStatusResponse = z.object({
  /** The account's current public recipient; null until the vault is set up. */
  recipient: VaultRecipient.nullable(),
  /**
   * An account recovery or a new recovery kit came after the vault recovery secret was last
   * sealed, so the next unlock gives the vault a new secret before anything else (spec 0003, R6).
   */
  resealDue: z.boolean(),
});
export type VaultStatusResponse = z.infer<typeof VaultStatusResponse>;

export const vaultStatus = {
  method: 'get',
  path: '/vault',
  operationId: 'getVaultStatus',
  summary:
    "Whether the account's vault is set up, and its current public recipient; 401 without a session",
  response: { description: 'The vault status', schema: VaultStatusResponse },
} as const satisfies RouteDefinition<typeof VaultStatusResponse>;

/** One passkey's envelope: the identity sealed to that passkey's PRF output. */
export const PasskeyEnvelope = z.strictObject({
  credentialId: CredentialId,
  ciphertext: VaultCiphertext,
});
export type PasskeyEnvelope = z.infer<typeof PasskeyEnvelope>;

export const SetUpVaultRequest = z.strictObject({
  recipient: VaultRecipient,
  /** Empty when no passkey of the account supports PRF; one per passkey. */
  passkeyEnvelopes: z
    .array(PasskeyEnvelope)
    .max(16)
    .refine((list) => new Set(list.map(({ credentialId }) => credentialId)).size === list.length),
  /** The identity sealed to the vault recovery secret, opened once on the device first. */
  recoveryEnvelope: VaultCiphertext,
});
export type SetUpVaultRequest = z.infer<typeof SetUpVaultRequest>;

export const SetUpVaultResponse = z.object({});

export const setUpVault = {
  method: 'post',
  path: '/vault',
  operationId: 'setUpVault',
  summary:
    "Stores a new vault's recipient and envelopes, within a vault_unlock window; 403 step_up_required, 409 vault_exists, 400 invalid_request for a credential that is not an active passkey of the account",
  body: SetUpVaultRequest,
  response: { description: 'Vault set up', schema: SetUpVaultResponse },
} as const satisfies RouteDefinition<typeof SetUpVaultResponse>;

export const VaultEnvelope = z.object({
  recipientId: z.uuid(),
  kind: z.enum(['passkey_prf', 'recovery']),
  /** The passkey's credential ID for `passkey_prf`; null for `recovery`. */
  credentialId: CredentialId.nullable(),
  ciphertext: VaultCiphertext,
});
export type VaultEnvelope = z.infer<typeof VaultEnvelope>;

export const VaultEnvelopesResponse = z.object({
  /** The current recipient and any rotated one still kept. */
  recipients: z.array(z.object({ id: z.uuid(), recipient: VaultRecipient, current: z.boolean() })),
  /** The recovery envelopes and the envelopes of the account's active passkeys only. */
  envelopes: z.array(VaultEnvelope),
});
export type VaultEnvelopesResponse = z.infer<typeof VaultEnvelopesResponse>;

export const vaultEnvelopes = {
  method: 'get',
  path: '/vault/envelopes',
  operationId: 'getVaultEnvelopes',
  summary:
    "The vault's envelopes, within a vault_unlock window, recorded as fetched; 403 step_up_required, 404 not_found before the vault is set up",
  response: { description: 'The envelopes', schema: VaultEnvelopesResponse },
} as const satisfies RouteDefinition<typeof VaultEnvelopesResponse>;

export const AddVaultEnvelopeResponse = z.object({});

export const addVaultEnvelope = {
  method: 'post',
  path: '/vault/envelopes',
  operationId: 'addVaultEnvelope',
  summary:
    "Adds a passkey's envelope for the current recipient, within a vault_unlock window, keeping one already there; 403 step_up_required, 404 not_found before the vault is set up, 400 invalid_request for a credential that is not an active passkey of the account",
  body: PasskeyEnvelope,
  response: { description: 'Envelope stored', schema: AddVaultEnvelopeResponse },
} as const satisfies RouteDefinition<typeof AddVaultEnvelopeResponse>;

export const RotateVaultIdentityRequest = SetUpVaultRequest.extend({
  /** The current recipient being rotated, as the device last fetched it. */
  from: z.uuid(),
});
export type RotateVaultIdentityRequest = z.infer<typeof RotateVaultIdentityRequest>;

export const RotateVaultIdentityResponse = z.object({});

export const rotateVaultIdentity = {
  method: 'post',
  path: '/vault/rotate',
  operationId: 'rotateVaultIdentity',
  summary:
    "Makes a new identity's recipient current, with its envelopes, and marks the old one rotated, keeping its envelopes, after a sensitive_settings step-up whose target is the rotated recipient and whose fields carry the new one; 403 step_up_required, 404 not_found before set-up, 409 vault_changed unless the recipient named is still current, 400 invalid_request for a credential that is not an active passkey of the account",
  body: RotateVaultIdentityRequest,
  response: { description: 'Identity rotated', schema: RotateVaultIdentityResponse },
} as const satisfies RouteDefinition<typeof RotateVaultIdentityResponse>;

export const ResealVaultRecoveryRequest = z.strictObject({
  /** One per recipient the account keeps, each the identity sealed to the new recovery secret. */
  envelopes: z
    .array(z.strictObject({ recipientId: z.uuid(), ciphertext: VaultCiphertext }))
    .min(1)
    .max(32)
    .refine((list) => new Set(list.map(({ recipientId }) => recipientId)).size === list.length),
});
export type ResealVaultRecoveryRequest = z.infer<typeof ResealVaultRecoveryRequest>;

export const ResealVaultRecoveryResponse = z.object({});

export const resealVaultRecovery = {
  method: 'put',
  path: '/vault/recovery-envelopes',
  operationId: 'resealVaultRecovery',
  summary:
    "Replaces every recovery envelope at once, so the old vault recovery secret opens none, after a sensitive_settings step-up whose targets are the recipient IDs in order; 403 step_up_required, 404 not_found before set-up, 409 vault_changed unless the list names exactly the account's recipients",
  body: ResealVaultRecoveryRequest,
  response: { description: 'Recovery envelopes re-sealed', schema: ResealVaultRecoveryResponse },
} as const satisfies RouteDefinition<typeof ResealVaultRecoveryResponse>;

export const ResetVaultResponse = z.object({});

export const resetVault = {
  method: 'delete',
  path: '/vault',
  operationId: 'resetVault',
  summary:
    "Deletes the vault's recipients, envelopes and sharing state, so it can be set up again, after a sensitive_settings step-up; 403 step_up_required, 404 not_found before set-up, 409 vault_has_documents while the account owns a document",
  body: z.strictObject({}),
  response: { description: 'Vault reset', schema: ResetVaultResponse },
} as const satisfies RouteDefinition<typeof ResetVaultResponse>;

/** Where an account's notifications go: its email, or a browser's push subscription (spec 0005, R7). */
export const NotificationChannel = z.object({
  id: z.uuid(),
  kind: z.enum(['email', 'web_push']),
  /** The families that subscribed; null for email. */
  browser: z.enum(browserFamilies).nullable(),
  os: z.enum(osFamilies).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  lastSuccessAt: z.iso.datetime({ offset: true }).nullable(),
});
export type NotificationChannel = z.infer<typeof NotificationChannel>;

export const NotificationChannelsResponse = z.object({
  channels: z.array(NotificationChannel),
  /** The environment's VAPID public key, base64url; null where push is not set up. */
  pushKey: z
    .string()
    .regex(/^[A-Za-z0-9_-]{87}$/)
    .nullable(),
});
export type NotificationChannelsResponse = z.infer<typeof NotificationChannelsResponse>;

export const notificationChannels = {
  method: 'get',
  path: '/notifications/channels',
  operationId: 'listNotificationChannels',
  summary: "The account's notification channels and the push key; 401 without a session",
  response: { description: 'The channels', schema: NotificationChannelsResponse },
} as const satisfies RouteDefinition<typeof NotificationChannelsResponse>;

/**
 * The browsers' push services (Chrome and the browsers built on it, Firefox, Safari, Edge): the
 * server posts only to these, so a subscription cannot point it at any other host. Checked
 * 2026-11-04 against https://pushpad.xyz/blog/what-are-the-browser-push-services/.
 */
const pushServiceHosts = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
];
const pushServiceDomains = ['.push.apple.com', '.notify.windows.com'];

export function isPushServiceEndpoint(endpoint: string): boolean {
  if (!endpoint.startsWith('https://')) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.port !== '' || url.username !== '' || url.password !== '') return false;
  const host = url.hostname;
  return (
    pushServiceHosts.includes(host) || pushServiceDomains.some((domain) => host.endsWith(domain))
  );
}

/** Each push channel costs a step and a request per notice, so an account keeps a few. */
export const maxPushChannels = 10;

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it, keys unpadded. */
export const AddPushChannelRequest = z.strictObject({
  endpoint: z.string().max(2048).refine(isPushServiceEndpoint),
  p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
  auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
});
export type AddPushChannelRequest = z.infer<typeof AddPushChannelRequest>;

export const AddPushChannelResponse = z.object({ channelId: z.uuid() });
export type AddPushChannelResponse = z.infer<typeof AddPushChannelResponse>;

export const addPushChannel = {
  method: 'post',
  path: '/notifications/channels',
  operationId: 'addPushChannel',
  summary:
    "Adds this browser's push subscription, described from its User-Agent like a session, or returns the channel it already has; 409 too_many_push_channels past 10, 503 push_unavailable where push is not set up",
  body: AddPushChannelRequest,
  response: { description: 'The channel', schema: AddPushChannelResponse },
} as const satisfies RouteDefinition<typeof AddPushChannelResponse>;

export const RemoveNotificationChannelRequest = z.strictObject({ channelId: z.uuid() });
export type RemoveNotificationChannelRequest = z.infer<typeof RemoveNotificationChannelRequest>;

export const RemoveNotificationChannelResponse = z.object({});

export const removeNotificationChannel = {
  method: 'post',
  path: '/notifications/channels/remove',
  operationId: 'removeNotificationChannel',
  summary:
    'Removes a push channel after a sensitive_settings step-up; 403 step_up_required, 404 not_found for an unknown or email channel',
  body: RemoveNotificationChannelRequest,
  response: { description: 'Removed', schema: RemoveNotificationChannelResponse },
} as const satisfies RouteDefinition<typeof RemoveNotificationChannelResponse>;

/** The largest document ciphertext the vault stores (spec 0005, R3). */
export const maxDocumentBytes = 25 * 1024 * 1024;

/** What one account may keep in the vault, pending uploads included (spec 0005, R4). */
export const documentQuota = { bytes: 1024 * 1024 * 1024, documents: 300 } as const;

/** The most documents one page of the list holds. */
export const documentPageSize = 50;

/** A SHA-256 digest, base64url without padding. */
const Sha256 = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const CreateDocumentRequest = z.strictObject({
  /** The document type's catalog key, such as `passport`; never a name or a number. */
  typeKey: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
  /** The ciphertext's size in bytes. */
  size: z.int().min(1).max(maxDocumentBytes),
  /** The ciphertext's SHA-256, which the upload must match. */
  sha256: Sha256,
});
export type CreateDocumentRequest = z.infer<typeof CreateDocumentRequest>;

/**
 * Where the device sends the ciphertext: Vercel Blob, through the SDK's presigned upload with
 * this pathname and the upload-URL route; or, in development only, a URL on this origin.
 */
export const DocumentUpload = z.discriminatedUnion('via', [
  z.object({ via: z.literal('vercel_blob'), pathname: z.string() }),
  z.object({ via: z.literal('direct'), url: z.string() }),
]);
export type DocumentUpload = z.infer<typeof DocumentUpload>;

export const CreateDocumentResponse = z.object({ documentId: z.uuid(), upload: DocumentUpload });
export type CreateDocumentResponse = z.infer<typeof CreateDocumentResponse>;

export const createDocument = {
  method: 'post',
  path: '/vault/documents',
  operationId: 'createDocument',
  summary:
    'Adds a pending document and says where to upload its ciphertext; 401 without a session, 403 account_unconfirmed, 403 step_up_required outside a vault_unlock window, 404 not_found before the vault is set up, 409 document_quota past 300 documents or 1 GiB, 429 rate_limited',
  body: CreateDocumentRequest,
  response: { description: 'Pending document', schema: CreateDocumentResponse },
} as const satisfies RouteDefinition<typeof CreateDocumentResponse>;

/** The request `uploadPresigned` from `@vercel/blob/client` sends for one pending document. */
export const DocumentUploadUrlRequest = z.strictObject({
  type: z.literal('blob.generate-presigned-url'),
  payload: z.strictObject({
    pathname: z.string().max(128),
    clientPayload: z.string().max(256).nullable(),
    multipart: z.literal(false),
  }),
});

export const DocumentUploadUrlResponse = z.object({
  type: z.literal('blob.generate-presigned-url'),
  presignedUrlPayload: z.object({
    delegationToken: z.string(),
    signature: z.string(),
    params: z.record(z.string(), z.string()),
  }),
});
export type DocumentUploadUrlResponse = z.infer<typeof DocumentUploadUrlResponse>;

export const documentUploadUrl = {
  method: 'post',
  path: '/vault/documents/upload-url',
  operationId: 'documentUploadUrl',
  summary:
    "A presigned upload for one pending document's pathname, valid for 5 minutes and limited to its declared size; 401 without a session, 404 not_found unless the pathname is a pending document of the account created within the hour",
  body: DocumentUploadUrlRequest,
  response: { description: 'Presigned upload', schema: DocumentUploadUrlResponse },
} as const satisfies RouteDefinition<typeof DocumentUploadUrlResponse>;

export const DocumentReference = z.strictObject({ documentId: z.uuid() });

export const ConfirmDocumentUploadResponse = z.object({});

export const confirmDocumentUpload = {
  method: 'post',
  path: '/vault/documents/confirm',
  operationId: 'confirmDocumentUpload',
  summary:
    'Confirms a pending upload once the stored ciphertext has the declared size and SHA-256; any other ciphertext is deleted and the document stays pending until the daily cleanup; 401 without a session, 404 not_found, 409 not_uploaded before the upload, 409 upload_mismatch, 429 rate_limited',
  body: DocumentReference,
  response: { description: 'Upload confirmed', schema: ConfirmDocumentUploadResponse },
} as const satisfies RouteDefinition<typeof ConfirmDocumentUploadResponse>;

export const VaultDocument = z.object({
  id: z.uuid(),
  typeKey: z.string(),
  size: z.int(),
  sha256: Sha256,
  createdAt: z.iso.datetime({ offset: true }),
  /** The owner's account; another account's when the document is shared with this one. */
  ownerId: z.uuid(),
  /** For the owner, the accounts it is shared with; empty for a recipient. */
  sharedWith: z.array(z.uuid()),
});
export type VaultDocument = z.infer<typeof VaultDocument>;

export const DocumentsQuery = z.object({
  /** The last document of the previous page. */
  after: z.uuid().optional(),
});

export const DocumentsResponse = z.object({
  documents: z.array(VaultDocument).max(documentPageSize),
  /** Pass as `after` for the next page; null on the last page. */
  next: z.uuid().nullable(),
});
export type DocumentsResponse = z.infer<typeof DocumentsResponse>;

export const listDocuments = {
  method: 'get',
  path: '/vault/documents',
  operationId: 'listDocuments',
  summary:
    'The confirmed documents the account owns or that are shared with it, in document ID order, at most 50 a page; 401 without a session',
  query: DocumentsQuery,
  response: { description: 'A page of documents', schema: DocumentsResponse },
} as const satisfies RouteDefinition<typeof DocumentsResponse>;

export const DocumentDownloadResponse = z.object({
  /** Reads the ciphertext until `expiresAt`, five minutes from now. */
  url: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
});

export const documentDownloadUrl = {
  method: 'post',
  path: '/vault/documents/download',
  operationId: 'documentDownloadUrl',
  summary:
    "A short-lived URL to one confirmed document's ciphertext, for its owner or a recipient, within the session's vault_unlock window; 401 without a session, 403 step_up_required, 404 not_found",
  body: DocumentReference,
  response: { description: 'Download URL', schema: DocumentDownloadResponse },
} as const satisfies RouteDefinition<typeof DocumentDownloadResponse>;

/** The most documents one replace, confirm-replacement or delete request names (spec 0005, R4). */
export const maxDocumentBatch = 32;

/** The most accounts besides its owner that one document is encrypted to. */
export const maxDocumentRecipients = 16;

const documentIds = z
  .array(z.uuid())
  .min(1)
  .max(maxDocumentBatch)
  .refine((ids) => new Set(ids).size === ids.length, 'each document once');

export const ReplaceDocumentsRequest = z.strictObject({
  /**
   * The linked accounts the new ciphertexts are encrypted to, besides the owner, in ascending
   * order; the shares become exactly these. Empty shares with nobody.
   */
  recipients: z
    .array(z.uuid())
    .max(maxDocumentRecipients)
    .refine(
      (ids) => ids.every((id, index) => index === 0 || (ids[index - 1] ?? '') < id),
      'ascending, each account once',
    ),
  documents: z
    .array(
      z.strictObject({
        documentId: z.uuid(),
        size: z.int().min(1).max(maxDocumentBytes),
        sha256: Sha256,
      }),
    )
    .min(1)
    .max(maxDocumentBatch)
    .refine(
      (documents) =>
        new Set(documents.map(({ documentId }) => documentId)).size === documents.length,
      'each document once',
    ),
});
export type ReplaceDocumentsRequest = z.infer<typeof ReplaceDocumentsRequest>;

/**
 * The `vault_write` step-up's action for a replace (spec 0003, R5): the documents in order as
 * targets, and the recipients and each new object's size and SHA-256 as fields, so the passkey
 * approves exactly these ciphertexts for exactly these accounts.
 */
export function replaceDocumentsAction({ recipients, documents }: ReplaceDocumentsRequest) {
  return {
    action: 'replaceDocuments',
    targets: documents.map(({ documentId }) => documentId),
    fields: {
      recipients: recipients.join(','),
      objects: documents.map(({ size, sha256 }) => `${String(size)}:${sha256}`).join(','),
    },
  };
}

export const ReplaceDocumentsResponse = z.object({
  uploads: z.array(z.object({ documentId: z.uuid(), upload: DocumentUpload })),
});
export type ReplaceDocumentsResponse = z.infer<typeof ReplaceDocumentsResponse>;

export const replaceDocuments = {
  method: 'post',
  path: '/vault/documents/replace',
  operationId: 'replaceDocuments',
  summary:
    'Approves new ciphertext for confirmed documents the account owns, encrypted to the given linked accounts, and says where to upload each; for sharing, revoking and rotating; needs a consumed vault_write step-up for this exact request; 401 without a session, 403 step_up_required, 404 not_found unless every document is a confirmed one of the account, 409 not_linked for an account without a link, 409 document_quota',
  body: ReplaceDocumentsRequest,
  response: {
    description: 'Where to upload each new ciphertext',
    schema: ReplaceDocumentsResponse,
  },
} as const satisfies RouteDefinition<typeof ReplaceDocumentsResponse>;

export const DocumentBatch = z.strictObject({ documentIds });
export type DocumentBatch = z.infer<typeof DocumentBatch>;

export const ConfirmReplacementsResponse = z.object({
  results: z.array(
    z.object({
      documentId: z.uuid(),
      outcome: z.enum(['replaced', 'not_found', 'not_uploaded', 'mismatch']),
    }),
  ),
});
export type ConfirmReplacementsResponse = z.infer<typeof ConfirmReplacementsResponse>;

export const confirmReplacements = {
  method: 'post',
  path: '/vault/documents/replace/confirm',
  operationId: 'confirmReplacements',
  summary:
    "Swaps in each approved replacement whose upload has the approved size and SHA-256, and sets the document's shares to its recipients; deletes any other upload; one outcome per document, in order; 401 without a session, 429 rate_limited",
  body: DocumentBatch,
  response: { description: 'One outcome per document', schema: ConfirmReplacementsResponse },
} as const satisfies RouteDefinition<typeof ConfirmReplacementsResponse>;

/** The `vault_write` step-up's action for a delete: the documents in order as targets. */
export function deleteDocumentsAction({ documentIds: targets }: DocumentBatch) {
  return { action: 'deleteDocuments', targets };
}

export const DeleteDocumentsResponse = z.object({});
export type DeleteDocumentsResponse = z.infer<typeof DeleteDocumentsResponse>;

export const deleteDocuments = {
  method: 'post',
  path: '/vault/documents/delete',
  operationId: 'deleteDocuments',
  summary:
    'Deletes documents the account owns, pending or confirmed, with their shares and ciphertext; needs a consumed vault_write step-up for this exact request; 401 without a session, 403 step_up_required, 404 not_found unless every document is one of the account',
  body: DocumentBatch,
  response: { description: 'Deleted', schema: DeleteDocumentsResponse },
} as const satisfies RouteDefinition<typeof DeleteDocumentsResponse>;

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
  listDevices,
  revokeSession,
  revokePasskey,
  revokeOtherSessions,
  addPasskeyOptions,
  addPasskey,
  recoveryStart,
  recoveryRedeem,
  recoveryOptions,
  recoveryVerify,
  auditEvents,
  exportAccountData,
  requestAccountDeletion,
  cancelAccountDeletion,
  vaultStatus,
  setUpVault,
  vaultEnvelopes,
  addVaultEnvelope,
  rotateVaultIdentity,
  resealVaultRecovery,
  resetVault,
  notificationChannels,
  addPushChannel,
  removeNotificationChannel,
  createDocument,
  documentUploadUrl,
  confirmDocumentUpload,
  listDocuments,
  documentDownloadUrl,
  replaceDocuments,
  confirmReplacements,
  deleteDocuments,
} as const;

/** The Better Auth endpoints the API lets through; every other path under /v1/auth is a 404. */
export const authRoutes = [signOut, passkeySignInOptions, passkeySignIn] as const;

/**
 * Every static segment of the API's paths. Telemetry keeps these in a URL and reduces any other
 * segment, which may be an ID or a token, to `:param` (spec 0004 R3).
 */
export const apiPathSegments: readonly string[] = [
  ...new Set(
    Object.values(routes).flatMap(({ path }) =>
      `${apiBasePath}${path}`.split('/').filter((segment) => segment !== ''),
    ),
  ),
];

/**
 * The static segments of the web app's own paths, its pages and its built files, which the API
 * links to and the browser reports from; the web app's typecheck holds this to its routes.
 */
export const webPathSegments = [
  'assets',
  'devices',
  'enroll',
  'invite',
  'invites',
  'recover',
  'recovery-kit',
  'settings',
  'sign-in',
  'vault',
] as const;
