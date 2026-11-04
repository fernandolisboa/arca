import type { authRoutes } from '@arca/api-contract/routes';
import type { RateLimitRule } from './rate-limit.js';

const hour = 60 * 60;

/**
 * Per-IP limits on every allow-listed auth route (spec 0003, R10), keyed by operation so a route
 * added to the allow-list does not compile without one. Generous for a family behind one
 * address: an open sign-in screen refreshes its autofill options every 4 minutes.
 */
export const authRouteLimits: Readonly<
  Record<(typeof authRoutes)[number]['operationId'], RateLimitRule>
> = {
  passkeySignInOptions: { name: 'sign_in_options_ip', limit: 120, windowSeconds: hour },
  passkeySignIn: { name: 'sign_in_ip', limit: 30, windowSeconds: hour },
  signOut: { name: 'sign_out_ip', limit: 60, windowSeconds: hour },
};

/** At most one `sign_in_failed` event per credential per hour (spec 0003, R7). */
export const signInFailedLog: RateLimitRule = {
  name: 'sign_in_failed_log',
  limit: 1,
  windowSeconds: hour,
};

/** Per-session limits on the step-up routes, which only a signed-in session reaches (spec 0003, R10). */
export const stepUpLimits = {
  options: { name: 'step_up_options_session', limit: 20, windowSeconds: hour },
  verify: { name: 'step_up_verify_session', limit: 20, windowSeconds: hour },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Per-IP limits on enrollment and registration (spec 0003, R10). The registration link's token
 * is 256 random bits, so these bound load, not guessing.
 */
export const registrationLimits = {
  enrollOwner: { name: 'enroll_owner_ip', limit: 5, windowSeconds: hour },
  options: { name: 'registration_options_ip', limit: 30, windowSeconds: hour },
  verify: { name: 'registration_verify_ip', limit: 30, windowSeconds: hour },
} as const satisfies Record<string, RateLimitRule>;

/** Limits on invites (spec 0003, R10): sending is per account per day, reading a link per IP. */
export const inviteLimits = {
  create: { name: 'invite_create_account', limit: 20, windowSeconds: 24 * hour },
  details: { name: 'invite_details_ip', limit: 30, windowSeconds: hour },
} as const satisfies Record<string, RateLimitRule>;

/** Per-session limit on storing a new passkey; its options already spend a step-up each. */
export const deviceLimits = {
  addPasskey: { name: 'add_passkey_session', limit: 10, windowSeconds: hour },
} as const satisfies Record<string, RateLimitRule>;

/** Per-account limit on adding push channels, which the channel cap bounds again. */
export const notificationLimits = {
  addPushChannel: { name: 'add_push_channel_account', limit: 30, windowSeconds: hour },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Limits on recovery (spec 0003, R10): starting is per email HMAC and per IP; the link's token is
 * 256 random bits and five wrong codes lock the account's recovery, so the rest bound load.
 */
export const recoveryLimits = {
  startEmail: { name: 'recovery_start_email', limit: 3, windowSeconds: hour },
  startIp: { name: 'recovery_start_ip', limit: 10, windowSeconds: hour },
  redeem: { name: 'recovery_redeem_ip', limit: 30, windowSeconds: hour },
  options: { name: 'recovery_options_ip', limit: 30, windowSeconds: hour },
  verify: { name: 'recovery_verify_ip', limit: 30, windowSeconds: hour },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Per-IP limits on the monitoring tunnel (spec 0004, R5), so it cannot be used as a relay. The
 * browser SDK backs off on a 429, and a page reports each error once.
 */
export const monitoringLimits = {
  envelope: { name: 'monitoring_envelope_ip', limit: 60, windowSeconds: hour },
  cspReports: { name: 'monitoring_csp_ip', limit: 60, windowSeconds: hour },
} as const satisfies Record<string, RateLimitRule>;
