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
  forgetPushChannel: { name: 'forget_push_channel_account', limit: 30, windowSeconds: hour },
} as const satisfies Record<string, RateLimitRule>;

/** Storing a sharing state follows the owner's own shares and revocations. */
export const vaultLimits = {
  storeSharingState: { name: 'sharing_state_store_account', limit: 60, windowSeconds: hour },
} as const satisfies Record<string, RateLimitRule>;

/** Per-account limits on adding documents and confirming their uploads (spec 0005, R4). */
export const documentLimits = {
  create: { name: 'document_create_account', limit: 60, windowSeconds: hour },
  confirm: { name: 'document_confirm_account', limit: 60, windowSeconds: hour },
} as const satisfies Record<string, RateLimitRule>;

/** Case writes and rule reports per account; the case's playback, evaluations and comparison per session (spec 0007, ADR-0026). */
export const caseLimits = {
  write: { name: 'case_write_account', limit: 300, windowSeconds: hour },
  playback: { name: 'case_playback_session', limit: 60, windowSeconds: hour },
  evaluations: { name: 'case_evaluations_session', limit: 60, windowSeconds: hour },
  comparison: { name: 'case_comparison_session', limit: 60, windowSeconds: hour },
  reports: { name: 'rule_report_account', limit: 20, windowSeconds: 24 * hour },
} as const satisfies Record<string, RateLimitRule>;

/** Correction requests an owner-list admin files per account (ADR-0029). */
export const correctionRequestLimits = {
  file: { name: 'correction_request_account', limit: 30, windowSeconds: 24 * hour },
  upload: { name: 'correction_upload_account', limit: 60, windowSeconds: 24 * hour },
  presign: { name: 'correction_presign_account', limit: 60, windowSeconds: 24 * hour },
  download: { name: 'correction_download_account', limit: 120, windowSeconds: 24 * hour },
} as const satisfies Record<string, RateLimitRule>;

/**
 * The corrector routes (ADR-0029): every request is counted per address before its key is read,
 * so a guessing client is slowed and a refused key writes at most a few audit events an hour;
 * a key that holds is counted again per key, per route.
 */
export const correctorLimits = {
  address: { name: 'corrector_ip', limit: 120, windowSeconds: hour },
  refusedLog: { name: 'corrector_refused_log_ip', limit: 5, windowSeconds: hour },
  list: { name: 'corrector_list_key', limit: 100, windowSeconds: 24 * hour },
  file: { name: 'corrector_file_key', limit: 200, windowSeconds: 24 * hour },
  answer: { name: 'corrector_answer_key', limit: 100, windowSeconds: 24 * hour },
} as const satisfies Record<string, RateLimitRule>;

/** The corrector key screen: making and revoking keys per owner-list admin. */
export const correctorKeyLimits = {
  change: { name: 'corrector_key_change_account', limit: 20, windowSeconds: 24 * hour },
} as const satisfies Record<string, RateLimitRule>;

/** Free-text drafts per account (spec 0008, R3): each one is a paid model call. */
export const intakeLimits = {
  day: { name: 'case_intake_day', limit: 10, windowSeconds: 24 * hour },
  minute: { name: 'case_intake_minute', limit: 3, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Rule summaries per admin (ADR-0025): a request the cache misses is one model call, two when
 * the first reply does not parse.
 */
export const ruleSummaryLimits = {
  day: { name: 'rule_summary_day', limit: 30, windowSeconds: 24 * hour },
  minute: { name: 'rule_summary_minute', limit: 5, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * An admin's own rule checks (ADR-0027): no daily cap, only a burst limit no person tapping the
 * button reaches; it slows a looping client or a stolen session but does not bound daily spend.
 */
export const ruleCheckLimits = {
  minute: { name: 'rule_check_minute', limit: 10, windowSeconds: 60 },
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
