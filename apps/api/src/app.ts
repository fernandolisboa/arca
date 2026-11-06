import { OpenAPIHono } from '@hono/zod-openapi';
import {
  addPasskey,
  addPasskeyOptions,
  apiBasePath,
  AuditEventsQuery,
  authBasePath,
  authRoutes,
  confirmDocumentUpload,
  confirmInvite,
  confirmReplacements,
  createDocument,
  createInvite,
  deleteDocuments,
  deleteDocumentsAction,
  documentDownloadUrl,
  DocumentsQuery,
  documentUploadUrl,
  declineInvite,
  cancelAccountDeletion,
  enrollOwner,
  exportAccountData,
  inviteDetails,
  recoveryOptions,
  recoveryRedeem,
  recoveryStart,
  recoveryVerify,
  regenerateRecoveryKit,
  registrationOptions,
  replaceDocuments,
  replaceDocumentsAction,
  registrationVerify,
  requestAccountDeletion,
  revokeOtherSessions,
  revokePasskey,
  revokeSession,
  setUpVault,
  addVaultEnvelope,
  rotateVaultIdentity,
  resealVaultRecovery,
  resetVault,
  storeSharingState,
  addPushChannel,
  removeNotificationChannel,
  forgetPushChannel,
  CaseEvaluations,
  caseRoutes,
  CloseRuleReportsRequest,
  handOverCasePersonAction,
  addCaseMemberAction,
  leaveCaseAction,
  DecideVersionRequest,
  VersionView,
  VersionViewQuery,
  StepUpAction,
  stepUpNonceHeader,
  StepUpOptionsRequest,
  stepUpVerify,
  type ErrorResponse,
  type RouteDefinition,
} from '@arca/api-contract/routes';
import { openApiRoutes } from '@arca/api-contract/server';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { createMiddleware } from 'hono/factory';
import { routePath } from 'hono/route';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { DataExports } from './account/data-export.js';
import type { AccountDeletion } from './account/deletion.js';
import type { AuditReader } from './audit/log.js';
import { describeDevice } from './auth/device.js';
import type { AccountStatus, Devices } from './auth/devices.js';
import type { Enrollment } from './auth/enrollment.js';
import type { Invites } from './auth/invites.js';
import {
  authRouteLimits,
  caseLimits,
  deviceLimits,
  inviteLimits,
  monitoringLimits,
  documentLimits,
  vaultLimits,
  notificationLimits,
  recoveryLimits,
  registrationLimits,
  stepUpLimits,
} from './auth/limits.js';
import type { RateLimiter, RateLimitRule } from './auth/rate-limit.js';
import type { RecoveryKits } from './auth/recovery-kit.js';
import type { BehindAnswer, Recovery } from './auth/recovery.js';
import { behindAnswerOf } from './behind-answer.js';
import type { Registration, RegistrationOutcome } from './auth/registration.js';
import type { AuthService, SignedIn } from './auth/service.js';
import type { CanonicalAction } from './auth/step-up-encoding.js';
import type { ActionPurpose, StepUpService } from './auth/step-up.js';
import type { OutboxEntry } from './email/outbox.js';
import { bearerMatches } from './cron-auth.js';
import { cachedDatabaseCheck, type CheckDatabase } from './database-health.js';
import type { Tunnel } from './monitoring-tunnel.js';
import { securityTxt } from './security-txt.js';
import type { NotificationChannels } from './notification/channels.js';
import { isP256PublicKey } from './notification/push.js';
import type { CaseFiles, CaseWritten } from './case/case-files.js';
import type { DecisionKind } from '@arca/domain';
import type { DecisionOutcome, KnowledgeDecisions } from './knowledge/decisions.js';
import type { RuleReportReview } from './knowledge/reports.js';
import type { KnowledgeVersions } from './knowledge/versions.js';
import type { DocumentRequests } from './vault/documents.js';
import {
  memoryObjectsPath,
  objectUrlMinutes,
  type MemoryObjectStorage,
} from './vault/object-storage.js';
import type { Vault } from './vault/vault.js';
import { cspReportPath } from '@arca/security-policy';
import { tunnelPath, type Logger } from '@arca/telemetry';
import { utcDate, type IsoDate } from './workflows/workflow-arguments.js';

/** What the cron routes need; absent in tests that do not exercise them. */
export interface CronDependencies {
  /** Throws when `CRON_SECRET` is not set, which answers 500. */
  readonly readSecret: () => string;
  readonly startHeartbeat: (runDate: IsoDate) => Promise<unknown>;
  /** Starts `enforceRetention` for the day (spec 0004, R10). */
  readonly startRetention: (runDate: IsoDate) => Promise<unknown>;
  /** Starts `eraseAccount` for every account whose deletion is due (spec 0004, R9). */
  readonly startDueErasures: () => Promise<unknown>;
  /** Deletes the rate-limit windows that have ended (spec 0003, R10). */
  readonly sweepRateLimits: () => Promise<number>;
  readonly clock?: () => Date;
}

/** Limits on the auth routes (spec 0003, R10); required whenever `auth` is given. */
export interface AuthLimits {
  readonly limiter: Pick<RateLimiter, 'hit'>;
  /** The client's IP address, which the limiter HMACs before storing anything. */
  readonly clientAddress: (headers: Headers) => string;
}

export interface AppDependencies {
  readonly checkDatabase: CheckDatabase;
  readonly logger: Logger;
  /** Monotonic milliseconds, for durations and the health cache. */
  readonly now?: () => number;
  readonly newRequestId?: () => string;
  readonly cron?: CronDependencies;
  /**
   * The environment's own origin, the only one a state-changing `/v1` request may come from
   * (spec 0003, R4); absent, every such request is refused.
   */
  readonly origin?: string;
  /**
   * True where new accounts can be made; absent or false, as in a production with no sending
   * domain (spec 0003, R9), enrollment, invites, registration and recovery answer 503
   * `accounts_closed`.
   */
  readonly accountsOpen?: boolean;
  /** Better Auth behind the allow-list; absent, every auth path is a 404. */
  readonly auth?: AuthService;
  readonly authLimits?: AuthLimits;
  /** Purpose-bound step-up (spec 0003, R5); absent, its routes answer 401. */
  readonly stepUp?: StepUpService;
  /** Owner enrollment (spec 0003, R2); absent, its route is a 404. */
  readonly enrollment?: Enrollment;
  /** Passkey-first registration from a link (spec 0003, R2); absent, its routes are a 404. */
  readonly registration?: Registration;
  /** The account part of the recovery kit (spec 0003, R6); absent, its routes answer 401. */
  readonly recoveryKits?: RecoveryKits;
  /** Invites and their confirmation (spec 0003, R2); absent, their routes answer 401 or 404. */
  readonly invites?: Invites;
  /** The device list and its revocations (spec 0003, R4); absent, their routes answer 401. */
  readonly devices?: Devices;
  /** Recovery by email link and recovery code (spec 0003, R6); absent, its routes are a 404. */
  readonly recovery?: Recovery;
  /** The signed-in account's audit events; absent, the route answers 401. */
  readonly audit?: AuditReader;
  /** The account's data export (spec 0004, R8); absent, the route answers 401. */
  readonly dataExports?: DataExports;
  /** The account's deletion and its cancellation (spec 0004, R9); absent, the routes answer 401. */
  readonly accountDeletion?: AccountDeletion;
  /** The vault's recipients and envelopes (spec 0005, R2); absent, its routes answer 401. */
  readonly vault?: Vault;
  /** The vault's documents (spec 0005, R4); absent, their routes answer 401. */
  readonly documents?: DocumentRequests;
  /** The family's case (spec 0007, R3); absent, its routes answer 401. */
  readonly cases?: CaseFiles;
  /** Decisions on route versions (spec 0007, R7); absent, their routes answer 401. */
  readonly knowledge?: KnowledgeDecisions;
  /** The activation screen's reads (spec 0007, R7); absent, their routes answer 401. */
  readonly knowledgeVersions?: KnowledgeVersions;
  /** Approvers' view of members' rule reports (spec 0007, R8); absent, its routes answer 401. */
  readonly ruleReports?: RuleReportReview;
  /** Whether the account's inviter confirmed it, read on the app_auth pool (spec 0003, R2). */
  readonly accountConfirmed?: (accountId: string) => Promise<boolean>;
  /**
   * The in-memory object store, given only in development, whose upload and download URLs
   * `/internal/objects` serves; absent, that path is a 404.
   */
  readonly memoryObjects?: MemoryObjectStorage;
  /** The account's notification channels (spec 0005, R7); absent, their routes answer 401. */
  readonly notifications?: {
    readonly channels: NotificationChannels;
    /** The environment's VAPID public key; null where push is not set up. */
    readonly pushKey: string | null;
  };
  /**
   * The outbox's messages, given only on preview deployments, which Vercel Deployment
   * Protection keeps private (spec 0003, R8); absent, `/internal/outbox` is a 404.
   */
  readonly outbox?: () => Promise<readonly OutboxEntry[]>;
  /** Error monitoring's middleware, run in order before every other one (spec 0004, R4). */
  readonly monitor?: (app: Hono<AppEnv>) => readonly MiddlewareHandler[];
  /**
   * True only on previews: `/internal/monitoring-check` then throws an error carrying synthetic
   * personal data, to show that monitoring receives none of it (spec 0004, R4).
   */
  readonly syntheticError?: boolean;
  /**
   * The browser's way to Sentry, given where the deployment reports (spec 0004, R5); absent, the
   * tunnel and the CSP report path are 404s. Needs `authLimits` for its per-IP limits.
   */
  readonly tunnel?: Tunnel;
}

/** Synthetic values only, shaped like what a family's case holds. */
export class SyntheticPersonalDataError extends Error {
  override name = 'SyntheticPersonalDataError';
  constructor() {
    super('Maria Aparecida da Silva <maria.silva@example.com>, CPF 123.456.789-09', {
      cause: new Error('passaporte FZ123456, telefone +55 11 91234-5678'),
    });
  }
}

export type ErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'cross_origin'
  | 'not_found'
  | 'rate_limited'
  | 'step_up_refused'
  | 'step_up_required'
  | 'invalid_code'
  | 'registration_refused'
  | 'email_unavailable'
  | 'account_unconfirmed'
  | 'too_many_invites'
  | 'signed_in'
  | 'last_active_passkey'
  | 'passkey_refused'
  | 'recovery_locked'
  | 'recovery_pending'
  | 'deletion_pending'
  | 'vault_exists'
  | 'vault_changed'
  | 'vault_has_documents'
  | 'sharing_state_changed'
  | 'document_quota'
  | 'upload_mismatch'
  | 'not_uploaded'
  | 'not_linked'
  | 'push_unavailable'
  | 'case_exists'
  | 'case_limit'
  | 'case_invalid'
  | 'too_many_push_channels'
  | 'not_approver'
  | 'already_rejected'
  | 'accounts_closed'
  | 'too_large'
  | 'request_failed'
  | 'internal_error';

/** The session a request is signed in with, and what its account's passkeys say about it. */
interface RequestSession {
  readonly current: SignedIn | null;
  readonly status: AccountStatus | null;
}

export interface AppEnv {
  Variables: {
    requestId: string;
    errorCode?: ErrorCode;
    /** The request's session and its account's status, looked up once per request. */
    session?: Promise<RequestSession>;
    /** Class name of a thrown error; never its message, which may carry data. */
    errorName?: string;
    /** The platform's `waitUntil`, kept before a body limit replaces the request. */
    behind?: BehindAnswer;
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

const safeMethods: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Refuses a state-changing request from anywhere but the environment's own origin: `Origin` must
 * match exactly, or, without it, `Sec-Fetch-Site` must say `same-origin`, so a sibling `filx.app`
 * subdomain counts as another site (spec 0003, R4). `SameSite=Lax` is not the only guard.
 */
function sameOrigin(origin: string | undefined) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (safeMethods.has(c.req.method)) return next();
    const sent = c.req.header('origin');
    const allowed =
      sent === undefined ? c.req.header('sec-fetch-site') === 'same-origin' : sent === origin;
    if (origin === undefined || !allowed) return reject(c, 'cross_origin', 403);
    return next();
  });
}

/**
 * Better Auth's answer re-encoded through the contract: only the schema's fields reach the
 * client, so no session token leaves in a body; errors carry our codes, never its messages. The
 * cookies it set pass through.
 */
async function throughContract(c: Context<AppEnv>, route: RouteDefinition, response: Response) {
  for (const cookie of response.headers.getSetCookie())
    c.header('set-cookie', cookie, { append: true });
  const status = response.status as ContentfulStatusCode;
  if (!response.ok) {
    await response.body?.cancel();
    // One answer for every refusal, so a sign-in never tells whether a credential exists.
    return status >= 500 ? reject(c, 'internal_error', status) : reject(c, 'unauthorized', 401);
  }
  return c.json(route.response.schema.parse(await response.json()), status);
}

/** The JSON body, read from a clone so the request still reaches Better Auth intact. */
async function bodyOf(request: Request): Promise<unknown> {
  try {
    return await request.clone().json();
  } catch {
    return undefined;
  }
}

/** A router whose validation failures answer `invalid_request` without the validator's details. */
export function createRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => (result.success ? undefined : reject(c, 'invalid_request', 400)),
  });
}

/** A route and a request matched by exact method and path. */
const routeKey = ({ method, path }: Pick<RouteDefinition, 'method' | 'path'>) =>
  `${method.toUpperCase()} ${apiBasePath}${path}`;
const requestKey = (c: Context) => `${c.req.method} ${c.req.path}`;

/** The API as a plain Hono app, importable and testable without the Nitro shell. */
export function createApp({
  checkDatabase,
  logger,
  now = () => performance.now(),
  newRequestId = () => crypto.randomUUID(),
  cron,
  origin,
  accountsOpen = false,
  auth,
  authLimits,
  stepUp,
  enrollment,
  registration,
  recoveryKits,
  invites,
  devices,
  recovery,
  audit,
  dataExports,
  accountDeletion,
  vault,
  documents,
  cases,
  knowledge,
  knowledgeVersions,
  ruleReports,
  accountConfirmed,
  memoryObjects,
  notifications,
  outbox,
  monitor,
  syntheticError = false,
  tunnel,
}: AppDependencies) {
  // An auth route without its limit would be the gap the limits exist to close.
  if (auth !== undefined && authLimits === undefined) {
    throw new Error('the auth routes need their rate limits');
  }
  if (tunnel !== undefined && authLimits === undefined) {
    throw new Error('the monitoring tunnel needs its rate limits');
  }
  const app = createRouter();
  if (monitor !== undefined) app.use('*', ...monitor(app));

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
  app.use(`${apiBasePath}/*`, sameOrigin(origin));
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
    return c.json(
      {
        status: database === 'ok' ? 'ok' : 'degraded',
        checks: { database },
        accounts: accountsOpen ? 'open' : 'closed',
      },
      200,
    );
  });

  const lookUp = async (headers: Headers): Promise<RequestSession> => {
    if (auth === undefined) return { current: null, status: null };
    const current = await auth.signedIn(headers);
    if (current === null || devices === undefined) return { current, status: null };
    const status = await devices.status(current.accountId, current.sessionId);
    return { current: status.sessionEnded ? null : current, status };
  };
  const sessionOf = (c: Context<AppEnv>) => {
    let found = c.get('session');
    if (found === undefined) {
      found = lookUp(c.req.raw.headers);
      c.set('session', found);
    }
    return found;
  };
  const signedIn = async (c: Context<AppEnv>) => (await sessionOf(c)).current;
  /** Counts the request; over the limit, the 429 to answer with. */
  const overLimit = async (
    c: Context<AppEnv>,
    limits: AuthLimits,
    rule: RateLimitRule,
    subject: string,
  ) => {
    const outcome = await limits.limiter.hit(rule, subject);
    if (outcome.allowed) return undefined;
    c.header('Retry-After', String(outcome.retryAfterSeconds));
    c.set('errorCode', 'rate_limited');
    return c.json({ error: { code: 'rate_limited' } } satisfies ErrorResponse, 429);
  };
  const fail = <Status extends 400 | 401 | 403 | 404 | 409 | 503>(
    c: Context<AppEnv>,
    code: ErrorCode,
    status: Status,
  ) => {
    c.set('errorCode', code);
    return c.json({ error: { code } } satisfies ErrorResponse, status);
  };
  const unauthorized = (c: Context<AppEnv>) => fail(c, 'unauthorized', 401);
  /** Counted per client address, for the routes that come before any session. */
  const overAddressLimit = (c: Context<AppEnv>, limits: AuthLimits, rule: RateLimitRule) =>
    overLimit(c, limits, rule, limits.clientAddress(c.req.raw.headers));
  /** The action nonce the client sent in its header, for the step-up it spends. */
  const actionNonce = (c: Context<AppEnv>) => {
    const nonce = StepUpAction.shape.nonce.safeParse(c.req.header(stepUpNonceHeader));
    return nonce.success ? new Uint8Array(Buffer.from(nonce.data, 'base64url')) : undefined;
  };
  /**
   * `requireStepUp` (spec 0003, R5): spends this session's step-up for the purpose and for the
   * action recomputed from this request, with the nonce the client sent in its header.
   */
  const stepUpGranted = async (
    c: Context<AppEnv>,
    current: SignedIn,
    purpose: ActionPurpose,
    action: Omit<CanonicalAction, 'nonce'>,
  ) => {
    const nonce = actionNonce(c);
    if (stepUp === undefined || nonce === undefined) return false;
    return stepUp.consume(current, purpose, { ...action, nonce });
  };
  const registered = <Body extends object>(
    c: Context<AppEnv>,
    outcome: RegistrationOutcome<Body>,
  ) => {
    if (!outcome.ok) {
      if (outcome.reason === 'not_found') return fail(c, 'not_found', 404);
      return fail(
        c,
        outcome.reason === 'invalid_code' ? 'invalid_code' : 'registration_refused',
        403,
      );
    }
    for (const cookie of outcome.setCookies) c.header('set-cookie', cookie, { append: true });
    return c.json(outcome.body, 200);
  };

  /** Every route that makes, or proves the address of, an account (spec 0003, R9). */
  const makingAccounts = new Set(
    [
      openApiRoutes.enrollOwner,
      openApiRoutes.registrationOptions,
      openApiRoutes.registrationVerify,
      openApiRoutes.createInvite,
      openApiRoutes.inviteDetails,
      openApiRoutes.recoveryStart,
      openApiRoutes.recoveryRedeem,
      openApiRoutes.recoveryOptions,
      openApiRoutes.recoveryVerify,
    ].map(routeKey),
  );
  v1.use(
    '*',
    createMiddleware<AppEnv>(async (c, next) => {
      if (!accountsOpen && makingAccounts.has(requestKey(c))) {
        return reject(c, 'accounts_closed', 503);
      }
      return next();
    }),
  );

  /**
   * While a recovery passkey waits, a session of its account may only show so and cancel it
   * from the device list (spec 0003, R6); every other route answers 403 `recovery_pending`.
   * Signing in and out stay open, so a shared device can still change hands; the recovery routes
   * never read a session, so a cookie this browser still holds does not matter.
   */
  const whileRecoveryPending = new Set(
    [
      openApiRoutes.session,
      openApiRoutes.listDevices,
      openApiRoutes.revokePasskey,
      openApiRoutes.stepUpOptions,
      openApiRoutes.stepUpVerify,
      openApiRoutes.recoveryStart,
      openApiRoutes.recoveryRedeem,
      openApiRoutes.recoveryOptions,
      openApiRoutes.recoveryVerify,
      ...authRoutes,
    ].map(routeKey),
  );
  /**
   * While the account's deletion waits, a session may only show so and cancel it (spec 0004,
   * R9); every other route answers 403 `deletion_pending`. A recovery waiting too takes
   * precedence, with the cancel added.
   */
  const whileDeletionPending = new Set(
    [
      openApiRoutes.session,
      openApiRoutes.stepUpOptions,
      openApiRoutes.stepUpVerify,
      openApiRoutes.cancelAccountDeletion,
      ...authRoutes,
    ].map(routeKey),
  );
  const cancelDeletionKey = routeKey(openApiRoutes.cancelAccountDeletion);
  const restrictWhilePending = createMiddleware<AppEnv>(async (c, next) => {
    // Only a cookie carries a session, so a request without one has nothing to restrict.
    if (c.req.header('cookie') === undefined) return next();
    const key = requestKey(c);
    if (whileRecoveryPending.has(key) && whileDeletionPending.has(key)) return next();
    const { current, status } = await sessionOf(c);
    if (current === null || status === null) return next();
    const deletionPending = status.deletionDueAt !== null;
    // With both pending, the recovery's routes stay open, so the owner can still stop it, and so
    // does the deletion's cancel.
    if (status.recoveryPending) {
      if (whileRecoveryPending.has(key) || (deletionPending && key === cancelDeletionKey)) {
        return next();
      }
      return reject(c, 'recovery_pending', 403);
    }
    if (deletionPending && !whileDeletionPending.has(key)) {
      return reject(c, 'deletion_pending', 403);
    }
    return next();
  });
  v1.use('*', restrictWhilePending);
  // A case write is a few kilobytes; the cap keeps a member from making the API parse megabytes.
  const caseBodies = bodyLimit({
    maxSize: 256 * 1024,
    onError: (c: Context<AppEnv>) => reject(c, 'too_large', 413),
  });
  v1.use('/case', caseBodies);
  v1.use('/case/*', caseBodies);

  v1.openapi(openApiRoutes.session, async (c) => {
    if (auth === undefined) return unauthorized(c);
    // Looked up first, so a recovery activation that ends this session is seen before it slides.
    const { status } = await sessionOf(c);
    const { session, setCookies } = await auth.refresh(c.req.raw.headers);
    for (const cookie of setCookies) c.header('set-cookie', cookie, { append: true });
    if (session === null) return unauthorized(c);
    return c.json(
      {
        ...session,
        pendingPasskeyUntil: status?.pendingUntil?.toISOString() ?? null,
        recoveryPending: status?.recoveryPending ?? false,
        deletionDueAt: status?.deletionDueAt?.toISOString() ?? null,
        approver: knowledge?.isApprover(session.accountId) ?? false,
      },
      200,
    );
  });

  v1.openapi(openApiRoutes.stepUpOptions, async (c) => {
    const current = await signedIn(c);
    if (current === null || stepUp === undefined || authLimits === undefined) {
      return unauthorized(c);
    }
    const limited = await overLimit(c, authLimits, stepUpLimits.options, current.sessionId);
    if (limited !== undefined) return limited;
    // The router has already answered 400 to an invalid body; parsed again for its type.
    const request = StepUpOptionsRequest.parse(await c.req.json());
    return c.json(await stepUp.options(current, request), 200);
  });

  v1.openapi(openApiRoutes.stepUpVerify, async (c) => {
    const current = await signedIn(c);
    if (current === null || stepUp === undefined || authLimits === undefined) {
      return unauthorized(c);
    }
    const limited = await overLimit(c, authLimits, stepUpLimits.verify, current.sessionId);
    if (limited !== undefined) return limited;
    const { challengeId, response } = stepUpVerify.body.parse(await c.req.json());
    // One answer for every refusal reason, apart from the session's own 401.
    if (!(await stepUp.verify(current, challengeId, response))) {
      return fail(c, 'step_up_refused', 403);
    }
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.enrollOwner, async (c) => {
    if (enrollment === undefined || authLimits === undefined) return fail(c, 'not_found', 404);
    const limited = await overAddressLimit(c, authLimits, registrationLimits.enrollOwner);
    if (limited !== undefined) return limited;
    const outcome = await enrollment.enrollOwner(enrollOwner.body.parse(await c.req.json()));
    if (outcome === 'not_found') return fail(c, 'not_found', 404);
    if (outcome === 'email_unavailable') return fail(c, 'email_unavailable', 503);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.registrationOptions, async (c) => {
    if (registration === undefined || authLimits === undefined) return fail(c, 'not_found', 404);
    const limited = await overAddressLimit(c, authLimits, registrationLimits.options);
    if (limited !== undefined) return limited;
    // The passkey plugin would build the options for the session's own account, so the device
    // would store a passkey that verify then refuses; a link registers a new account only.
    if ((await signedIn(c)) !== null) return fail(c, 'signed_in', 409);
    const request = registrationOptions.body.parse(await c.req.json());
    return registered(c, await registration.options(c.req.raw.headers, request));
  });

  v1.openapi(openApiRoutes.registrationVerify, async (c) => {
    if (registration === undefined || authLimits === undefined) return fail(c, 'not_found', 404);
    const limited = await overAddressLimit(c, authLimits, registrationLimits.verify);
    if (limited !== undefined) return limited;
    const request = registrationVerify.body.parse(await c.req.json());
    return registered(c, await registration.verify(c.req.raw.headers, request));
  });

  v1.openapi(openApiRoutes.recoveryKitStatus, async (c) => {
    const current = await signedIn(c);
    if (current === null || recoveryKits === undefined) return unauthorized(c);
    return c.json({ status: await recoveryKits.status(current.accountId) }, 200);
  });

  // The first kit comes with the account; replacing one needs a step-up (spec 0003, R6).
  v1.openapi(openApiRoutes.regenerateRecoveryKit, async (c) => {
    const current = await signedIn(c);
    if (current === null || recoveryKits === undefined) return unauthorized(c);
    const first = await recoveryKits.issueFirst(current.accountId);
    if (first !== null) return c.json({ code: first }, 200);
    const approved = await stepUpGranted(c, current, 'sensitive_settings', {
      action: regenerateRecoveryKit.operationId,
      targets: [],
    });
    if (!approved) return fail(c, 'step_up_required', 403);
    return c.json({ code: await recoveryKits.regenerate(current.accountId) }, 200);
  });

  v1.openapi(openApiRoutes.confirmRecoveryKit, async (c) => {
    const current = await signedIn(c);
    if (current === null || recoveryKits === undefined) return unauthorized(c);
    if (!(await recoveryKits.confirm(current.accountId))) return fail(c, 'not_found', 404);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.createInvite, async (c) => {
    const current = await signedIn(c);
    if (current === null || invites === undefined || authLimits === undefined) {
      return unauthorized(c);
    }
    const limited = await overLimit(c, authLimits, inviteLimits.create, current.accountId);
    if (limited !== undefined) return limited;
    const { email } = createInvite.body.parse(await c.req.json());
    const outcome = await invites.create(current.accountId, email);
    if (outcome === 'unconfirmed') return fail(c, 'account_unconfirmed', 403);
    if (outcome === 'too_many') return fail(c, 'too_many_invites', 409);
    if (outcome === 'email_unavailable') return fail(c, 'email_unavailable', 503);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.listInvites, async (c) => {
    const current = await signedIn(c);
    if (current === null || invites === undefined) return unauthorized(c);
    return c.json({ invites: [...(await invites.list(current.accountId))] }, 200);
  });

  v1.openapi(openApiRoutes.inviteDetails, async (c) => {
    if (invites === undefined || authLimits === undefined) return fail(c, 'not_found', 404);
    const limited = await overAddressLimit(c, authLimits, inviteLimits.details);
    if (limited !== undefined) return limited;
    const details = await invites.details(inviteDetails.body.parse(await c.req.json()).token);
    return details === undefined ? fail(c, 'not_found', 404) : c.json(details, 200);
  });

  // Both decisions are bound to the invite by a step-up (spec 0003, R2).
  for (const [route, decide] of [
    [confirmInvite, 'confirm'],
    [declineInvite, 'decline'],
  ] as const) {
    v1.openapi(openApiRoutes[route.operationId], async (c) => {
      const current = await signedIn(c);
      if (current === null || invites === undefined) return unauthorized(c);
      const { inviteId } = route.body.parse(await c.req.json());
      const approved = await stepUpGranted(c, current, 'sensitive_settings', {
        action: route.operationId,
        targets: [inviteId],
      });
      if (!approved) return fail(c, 'step_up_required', 403);
      if (!(await invites[decide](current.accountId, inviteId))) return fail(c, 'not_found', 404);
      return c.json({}, 200);
    });
  }

  v1.openapi(openApiRoutes.listDevices, async (c) => {
    const current = await signedIn(c);
    if (current === null || devices === undefined) return unauthorized(c);
    return c.json(await devices.list(current), 200);
  });

  // Each revocation is bound to its target by a step-up (spec 0003, R4).
  v1.openapi(openApiRoutes.revokeSession, async (c) => {
    const current = await signedIn(c);
    if (current === null || devices === undefined) return unauthorized(c);
    const { sessionId } = revokeSession.body.parse(await c.req.json());
    const approved = await stepUpGranted(c, current, 'sensitive_settings', {
      action: revokeSession.operationId,
      targets: [sessionId],
    });
    if (!approved) return fail(c, 'step_up_required', 403);
    if (!(await devices.revokeSession(current, sessionId))) return fail(c, 'not_found', 404);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.revokePasskey, async (c) => {
    const current = await signedIn(c);
    if (current === null || devices === undefined) return unauthorized(c);
    const { passkeyId } = revokePasskey.body.parse(await c.req.json());
    const approved = await stepUpGranted(c, current, 'sensitive_settings', {
      action: revokePasskey.operationId,
      targets: [passkeyId],
    });
    if (!approved) return fail(c, 'step_up_required', 403);
    // The passkey's vault envelope goes first, so a failure in between leaves an orphan the
    // envelope route never serves rather than a revoked passkey that still opens the vault. It
    // runs inside the app_auth transaction, so no path may take app_auth while holding app_api:
    // the two small pools would wait on each other.
    const outcome = await devices.revokePasskey(current, passkeyId, (credentialId) =>
      vault === undefined
        ? Promise.resolve()
        : vault.forgetPasskey(current.accountId, credentialId),
    );
    if (outcome === 'not_found') return fail(c, 'not_found', 404);
    if (outcome === 'last_active') return fail(c, 'last_active_passkey', 409);
    if (outcome === 'recovery_pending') return fail(c, 'recovery_pending', 403);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.revokeOtherSessions, async (c) => {
    const current = await signedIn(c);
    if (current === null || devices === undefined) return unauthorized(c);
    const approved = await stepUpGranted(c, current, 'sensitive_settings', {
      action: revokeOtherSessions.operationId,
      targets: [],
    });
    if (!approved) return fail(c, 'step_up_required', 403);
    await devices.revokeOtherSessions(current);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.addPasskeyOptions, async (c) => {
    const current = await signedIn(c);
    if (current === null || devices === undefined) return unauthorized(c);
    const approved = await stepUpGranted(c, current, 'sensitive_settings', {
      action: addPasskeyOptions.operationId,
      targets: [],
    });
    if (!approved) return fail(c, 'step_up_required', 403);
    return c.json(await devices.addOptions(current), 200);
  });

  v1.openapi(openApiRoutes.addPasskey, async (c) => {
    const current = await signedIn(c);
    if (current === null || devices === undefined || authLimits === undefined) {
      return unauthorized(c);
    }
    const limited = await overLimit(c, authLimits, deviceLimits.addPasskey, current.sessionId);
    if (limited !== undefined) return limited;
    const { challengeId, response } = addPasskey.body.parse(await c.req.json());
    if (!(await devices.add(current, challengeId, response))) {
      return fail(c, 'passkey_refused', 403);
    }
    return c.json({}, 200);
  });

  // Recovery comes before any session (spec 0003, R6), so its routes are limited per address.
  v1.openapi(openApiRoutes.recoveryStart, async (c) => {
    if (recovery === undefined || authLimits === undefined) return fail(c, 'not_found', 404);
    const limited = await overAddressLimit(c, authLimits, recoveryLimits.startIp);
    if (limited !== undefined) return limited;
    const { email } = recoveryStart.body.parse(await c.req.json());
    const perEmail = await overLimit(c, authLimits, recoveryLimits.startEmail, email.toLowerCase());
    if (perEmail !== undefined) return perEmail;
    if (
      (await recovery.start(
        email,
        behindAnswerOf(c.req.raw, () => {
          logger.error({ errorName: 'BehindAnswerUnavailable' });
        }),
      )) === 'email_unavailable'
    ) {
      return fail(c, 'email_unavailable', 503);
    }
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.recoveryRedeem, async (c) => {
    if (recovery === undefined || authLimits === undefined) return fail(c, 'not_found', 404);
    const limited = await overAddressLimit(c, authLimits, recoveryLimits.redeem);
    if (limited !== undefined) return limited;
    const { token, code } = recoveryRedeem.body.parse(await c.req.json());
    const outcome = await recovery.redeem(token, code);
    if (outcome.ok) return c.json({ code: outcome.code, token: outcome.token }, 200);
    if (outcome.reason === 'not_found') return fail(c, 'not_found', 404);
    return fail(c, outcome.reason === 'locked' ? 'recovery_locked' : 'invalid_code', 403);
  });

  v1.openapi(openApiRoutes.recoveryOptions, async (c) => {
    if (recovery === undefined || authLimits === undefined) return fail(c, 'not_found', 404);
    const limited = await overAddressLimit(c, authLimits, recoveryLimits.options);
    if (limited !== undefined) return limited;
    const { token } = recoveryOptions.body.parse(await c.req.json());
    const options = await recovery.options(token);
    return options === null ? fail(c, 'not_found', 404) : c.json(options, 200);
  });

  v1.openapi(openApiRoutes.recoveryVerify, async (c) => {
    if (recovery === undefined || authLimits === undefined) return fail(c, 'not_found', 404);
    const limited = await overAddressLimit(c, authLimits, recoveryLimits.verify);
    if (limited !== undefined) return limited;
    const { token, response } = recoveryVerify.body.parse(await c.req.json());
    const device = describeDevice(c.req.header('user-agent'));
    const outcome = await recovery.verify(token, response, device);
    if (outcome === 'not_found') return fail(c, 'not_found', 404);
    if (outcome === 'refused') return fail(c, 'passkey_refused', 403);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.auditEvents, async (c) => {
    const current = await signedIn(c);
    if (current === null || audit === undefined) return unauthorized(c);
    // The router has already answered 400 to an invalid query; parsed again for its type.
    const query = AuditEventsQuery.parse(c.req.query());
    return c.json(await audit.events(current.accountId, query), 200);
  });

  v1.openapi(openApiRoutes.exportAccountData, async (c) => {
    const current = await signedIn(c);
    if (current === null || dataExports === undefined) return unauthorized(c);
    const approved = await stepUpGranted(c, current, 'data_export', {
      action: exportAccountData.operationId,
      targets: [],
    });
    if (!approved) return fail(c, 'step_up_required', 403);
    const document = await dataExports.build(current.accountId);
    // The name carries the date only, never anything of the account.
    c.header(
      'Content-Disposition',
      `attachment; filename="arca-export-${document.exportedAt.slice(0, 10)}.json"`,
    );
    return c.json(document, 200);
  });

  v1.openapi(openApiRoutes.requestAccountDeletion, async (c) => {
    const current = await signedIn(c);
    if (current === null || accountDeletion === undefined) return unauthorized(c);
    const approved = await stepUpGranted(c, current, 'account_deletion', {
      action: requestAccountDeletion.operationId,
      targets: [],
    });
    if (!approved) return fail(c, 'step_up_required', 403);
    const dueAt = await accountDeletion.request(current.accountId);
    if (dueAt === undefined) return unauthorized(c);
    return c.json({ dueAt: dueAt.toISOString() }, 200);
  });

  v1.openapi(openApiRoutes.cancelAccountDeletion, async (c) => {
    const current = await signedIn(c);
    if (current === null || accountDeletion === undefined) return unauthorized(c);
    const approved = await stepUpGranted(c, current, 'account_deletion', {
      action: cancelAccountDeletion.operationId,
      targets: [],
    });
    if (!approved) return fail(c, 'step_up_required', 403);
    if (!(await accountDeletion.cancel(current.accountId))) return fail(c, 'not_found', 404);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.vaultStatus, async (c) => {
    const current = await signedIn(c);
    if (current === null || vault === undefined) return unauthorized(c);
    return c.json(await vault.status(current.accountId), 200);
  });

  /** Reading or adding to the vault needs this session's `vault_unlock` window (spec 0005, R2). */
  const unlocked = async (current: SignedIn) =>
    stepUp !== undefined && (await stepUp.vaultUnlocked(current));

  v1.openapi(openApiRoutes.setUpVault, async (c) => {
    const current = await signedIn(c);
    if (current === null || vault === undefined) return unauthorized(c);
    if (!(await unlocked(current))) return fail(c, 'step_up_required', 403);
    const outcome = await vault.setUp(current.accountId, setUpVault.body.parse(await c.req.json()));
    if (outcome === 'exists') return fail(c, 'vault_exists', 409);
    if (outcome === 'unknown_passkey') return fail(c, 'invalid_request', 400);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.vaultEnvelopes, async (c) => {
    const current = await signedIn(c);
    if (current === null || vault === undefined) return unauthorized(c);
    if (!(await unlocked(current))) return fail(c, 'step_up_required', 403);
    const found = await vault.envelopes(current.accountId);
    return found === null ? fail(c, 'not_found', 404) : c.json(found, 200);
  });

  v1.openapi(openApiRoutes.addVaultEnvelope, async (c) => {
    const current = await signedIn(c);
    if (current === null || vault === undefined) return unauthorized(c);
    if (!(await unlocked(current))) return fail(c, 'step_up_required', 403);
    const sealed = addVaultEnvelope.body.parse(await c.req.json());
    const outcome = await vault.addEnvelope(current.accountId, sealed);
    if (outcome === 'no_vault') return fail(c, 'not_found', 404);
    if (outcome === 'unknown_passkey') return fail(c, 'invalid_request', 400);
    return c.json({}, 200);
  });

  // Changing which identity or secret opens the vault is bound to its action by a step-up.
  v1.openapi(openApiRoutes.rotateVaultIdentity, async (c) => {
    const current = await signedIn(c);
    if (current === null || vault === undefined) return unauthorized(c);
    const request = rotateVaultIdentity.body.parse(await c.req.json());
    const approved = await stepUpGranted(c, current, 'sensitive_settings', {
      action: rotateVaultIdentity.operationId,
      targets: [request.from],
      fields: { recipient: request.recipient },
    });
    if (!approved) return fail(c, 'step_up_required', 403);
    const outcome = await vault.rotate(current.accountId, request);
    if (outcome === 'no_vault') return fail(c, 'not_found', 404);
    if (outcome === 'changed') return fail(c, 'vault_changed', 409);
    if (outcome === 'sharing_state_changed') return fail(c, 'sharing_state_changed', 409);
    if (outcome === 'unknown_passkey') return fail(c, 'invalid_request', 400);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.resealVaultRecovery, async (c) => {
    const current = await signedIn(c);
    if (current === null || vault === undefined) return unauthorized(c);
    const request = resealVaultRecovery.body.parse(await c.req.json());
    const approved = await stepUpGranted(c, current, 'sensitive_settings', {
      action: resealVaultRecovery.operationId,
      targets: request.envelopes.map(({ recipientId }) => recipientId),
    });
    if (!approved) return fail(c, 'step_up_required', 403);
    const outcome = await vault.resealRecovery(current.accountId, request);
    if (outcome === 'no_vault') return fail(c, 'not_found', 404);
    if (outcome === 'changed') return fail(c, 'vault_changed', 409);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.resetVault, async (c) => {
    const current = await signedIn(c);
    if (current === null || vault === undefined) return unauthorized(c);
    const approved = await stepUpGranted(c, current, 'sensitive_settings', {
      action: resetVault.operationId,
      targets: [],
    });
    if (!approved) return fail(c, 'step_up_required', 403);
    const outcome = await vault.reset(current.accountId);
    if (outcome === 'no_vault') return fail(c, 'not_found', 404);
    if (outcome === 'has_documents') return fail(c, 'vault_has_documents', 409);
    return c.json({}, 200);
  });

  // The sharing state is tagged on the device; the server keeps it and its version (ADR-0018).
  v1.openapi(openApiRoutes.getSharingState, async (c) => {
    const current = await signedIn(c);
    if (current === null || vault === undefined) return unauthorized(c);
    return c.json({ sharingState: await vault.sharingState(current.accountId) }, 200);
  });

  v1.openapi(openApiRoutes.storeSharingState, async (c) => {
    const current = await signedIn(c);
    if (current === null || vault === undefined || authLimits === undefined) {
      return unauthorized(c);
    }
    if (!(await unlocked(current))) return fail(c, 'step_up_required', 403);
    const limited = await overLimit(
      c,
      authLimits,
      vaultLimits.storeSharingState,
      current.accountId,
    );
    if (limited !== undefined) return limited;
    const outcome = await vault.storeSharingState(
      current.accountId,
      storeSharingState.body.parse(await c.req.json()),
    );
    if (outcome === 'no_vault') return fail(c, 'not_found', 404);
    if (outcome === 'vault_changed') return fail(c, 'vault_changed', 409);
    if (outcome === 'changed') return fail(c, 'sharing_state_changed', 409);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.listAccountLinks, async (c) => {
    const current = await signedIn(c);
    if (current === null || vault === undefined) return unauthorized(c);
    return c.json({ links: await vault.links(current.accountId) }, 200);
  });

  // Documents (spec 0005, R4): metadata on app_api, ciphertext in the object store.
  v1.openapi(openApiRoutes.createDocument, async (c) => {
    const current = await signedIn(c);
    if (current === null || documents === undefined || authLimits === undefined) {
      return unauthorized(c);
    }
    if (accountConfirmed === undefined || !(await accountConfirmed(current.accountId))) {
      return fail(c, 'account_unconfirmed', 403);
    }
    if (!(await unlocked(current))) return fail(c, 'step_up_required', 403);
    const limited = await overLimit(c, authLimits, documentLimits.create, current.accountId);
    if (limited !== undefined) return limited;
    const outcome = await documents.create(
      current.accountId,
      createDocument.body.parse(await c.req.json()),
    );
    if (outcome === 'no_vault') return fail(c, 'not_found', 404);
    if (outcome === 'over_quota') return fail(c, 'document_quota', 409);
    return c.json(outcome, 200);
  });

  v1.openapi(openApiRoutes.documentUploadUrl, async (c) => {
    const current = await signedIn(c);
    if (current === null || documents === undefined) return unauthorized(c);
    const { payload } = documentUploadUrl.body.parse(await c.req.json());
    const presigned = await documents.presignUpload(current.accountId, payload.pathname);
    return presigned === undefined ? fail(c, 'not_found', 404) : c.json(presigned, 200);
  });

  v1.openapi(openApiRoutes.confirmDocumentUpload, async (c) => {
    const current = await signedIn(c);
    if (current === null || documents === undefined || authLimits === undefined) {
      return unauthorized(c);
    }
    const limited = await overLimit(c, authLimits, documentLimits.confirm, current.accountId);
    if (limited !== undefined) return limited;
    const { documentId } = confirmDocumentUpload.body.parse(await c.req.json());
    const outcome = await documents.confirm(current.accountId, documentId);
    if (outcome === 'not_found') return fail(c, 'not_found', 404);
    if (outcome === 'not_uploaded') return fail(c, 'not_uploaded', 409);
    if (outcome === 'mismatch') return fail(c, 'upload_mismatch', 409);
    return c.json({}, 200);
  });

  v1.openapi(openApiRoutes.listDocuments, async (c) => {
    const current = await signedIn(c);
    if (current === null || documents === undefined) return unauthorized(c);
    const { after } = DocumentsQuery.parse(c.req.query());
    return c.json(await documents.list(current.accountId, after), 200);
  });

  v1.openapi(openApiRoutes.documentDownloadUrl, async (c) => {
    const current = await signedIn(c);
    if (current === null || documents === undefined) return unauthorized(c);
    if (!(await unlocked(current))) return fail(c, 'step_up_required', 403);
    const { documentId } = documentDownloadUrl.body.parse(await c.req.json());
    const url = await documents.downloadUrl(current.accountId, documentId);
    if (url === undefined) return fail(c, 'not_found', 404);
    c.header('cache-control', 'no-store');
    const expiresAt = new Date(Date.now() + objectUrlMinutes * 60_000).toISOString();
    return c.json({ url, expiresAt }, 200);
  });

  // Replace and delete approve one exact batch with a vault_write step-up (spec 0005, R4).
  v1.openapi(openApiRoutes.replaceDocuments, async (c) => {
    const current = await signedIn(c);
    if (current === null || documents === undefined) return unauthorized(c);
    const request = replaceDocuments.body.parse(await c.req.json());
    if (!(await stepUpGranted(c, current, 'vault_write', await replaceDocumentsAction(request)))) {
      return fail(c, 'step_up_required', 403);
    }
    const outcome = await documents.replace(current.accountId, request);
    if (outcome === 'not_found') return fail(c, 'not_found', 404);
    if (outcome === 'not_linked') return fail(c, 'not_linked', 409);
    if (outcome === 'over_quota') return fail(c, 'document_quota', 409);
    return c.json(outcome, 200);
  });

  v1.openapi(openApiRoutes.confirmReplacements, async (c) => {
    const current = await signedIn(c);
    if (current === null || documents === undefined || authLimits === undefined) {
      return unauthorized(c);
    }
    const limited = await overLimit(c, authLimits, documentLimits.confirm, current.accountId);
    if (limited !== undefined) return limited;
    const { documentIds } = confirmReplacements.body.parse(await c.req.json());
    return c.json(await documents.confirmReplacements(current.accountId, documentIds), 200);
  });

  v1.openapi(openApiRoutes.deleteDocuments, async (c) => {
    const current = await signedIn(c);
    if (current === null || documents === undefined) return unauthorized(c);
    const request = deleteDocuments.body.parse(await c.req.json());
    if (!(await stepUpGranted(c, current, 'vault_write', deleteDocumentsAction(request)))) {
      return fail(c, 'step_up_required', 403);
    }
    const outcome = await documents.delete(current.accountId, request.documentIds);
    return outcome === 'not_found' ? fail(c, 'not_found', 404) : c.json({}, 200);
  });

  // The family's case (spec 0007, R3): a confirmed account, and writes within their hourly limit.
  const caseAccount = async (
    c: Context<AppEnv>,
    counted: 'write' | 'playback' | 'evaluations' | 'reports' | false,
  ) => {
    const current = await signedIn(c);
    if (current === null || cases === undefined || authLimits === undefined) {
      return { refused: unauthorized(c) };
    }
    if (accountConfirmed === undefined || !(await accountConfirmed(current.accountId))) {
      return { refused: fail(c, 'account_unconfirmed', 403) };
    }
    const limited =
      counted === 'write' || counted === 'reports'
        ? await overLimit(c, authLimits, caseLimits[counted], current.accountId)
        : counted === false
          ? undefined
          : await overLimit(c, authLimits, caseLimits[counted], current.sessionId);
    return limited === undefined ? { current, cases } : { refused: limited };
  };
  const caseAnswer = (c: Context<AppEnv>, outcome: CaseWritten) =>
    outcome.ok
      ? c.json({ case: outcome.view }, 200)
      : outcome.reason === 'not_found'
        ? fail(c, 'not_found', 404)
        : fail(c, outcome.reason, 409);
  /** A case write: its body, an optional step-up over it, then the write itself. */
  const caseWrite = <Body>(
    route: (typeof openApiRoutes)[keyof typeof caseRoutes],
    body: { parse: (value: unknown) => Body },
    run: (files: CaseFiles, accountId: string, request: Body) => Promise<CaseWritten>,
    stepUpFor?: (request: Body) => Omit<CanonicalAction, 'nonce'> | undefined,
  ) =>
    v1.openapi(route, async (c) => {
      const account = await caseAccount(c, 'write');
      if ('refused' in account) return account.refused;
      const request = body.parse(await c.req.json());
      const action = stepUpFor?.(request);
      if (
        action !== undefined &&
        !(await stepUpGranted(c, account.current, 'sensitive_settings', action))
      ) {
        return fail(c, 'step_up_required', 403);
      }
      return caseAnswer(c, await run(account.cases, account.current.accountId, request));
    });

  v1.openapi(openApiRoutes.getCase, async (c) => {
    const account = await caseAccount(c, false);
    if ('refused' in account) return account.refused;
    return c.json({ case: await account.cases.view(account.current.accountId) }, 200);
  });
  caseWrite(openApiRoutes.createCase, caseRoutes.createCase.body, (files, id, { displayName }) =>
    files.create(id, displayName),
  );
  caseWrite(openApiRoutes.addCasePerson, caseRoutes.addCasePerson.body, (files, id, request) =>
    files.addPerson(id, request),
  );
  caseWrite(
    openApiRoutes.updateCasePerson,
    caseRoutes.updateCasePerson.body,
    (files, id, request) => files.updatePerson(id, request),
  );
  caseWrite(
    openApiRoutes.removeCasePerson,
    caseRoutes.removeCasePerson.body,
    (files, id, { personId }) => files.removePerson(id, personId),
  );
  caseWrite(
    openApiRoutes.handOverCasePerson,
    caseRoutes.handOverCasePerson.body,
    (files, id, request) => files.handOver(id, request),
    handOverCasePersonAction,
  );
  caseWrite(
    openApiRoutes.addCaseMember,
    caseRoutes.addCaseMember.body,
    (files, id, request) => files.addMember(id, request),
    addCaseMemberAction,
  );
  caseWrite(
    openApiRoutes.writeCaseProfile,
    caseRoutes.writeCaseProfile.body,
    (files, id, request) => files.writeProfile(id, request),
  );
  caseWrite(
    openApiRoutes.writeCaseFinances,
    caseRoutes.writeCaseFinances.body,
    (files, id, request) => files.writeFinances(id, request),
  );
  caseWrite(
    openApiRoutes.replaceCaseShares,
    caseRoutes.replaceCaseShares.body,
    (files, id, request) => files.replaceShares(id, request),
  );
  caseWrite(
    openApiRoutes.addCaseRelationship,
    caseRoutes.addCaseRelationship.body,
    (files, id, relationship) => files.addRelationship(id, relationship),
  );
  caseWrite(
    openApiRoutes.removeCaseRelationship,
    caseRoutes.removeCaseRelationship.body,
    (files, id, { relationshipId }) => files.removeRelationship(id, relationshipId),
  );
  caseWrite(openApiRoutes.addCaseAsset, caseRoutes.addCaseAsset.body, (files, id, request) =>
    files.addAsset(id, request),
  );
  caseWrite(openApiRoutes.updateCaseAsset, caseRoutes.updateCaseAsset.body, (files, id, request) =>
    files.updateAsset(id, request),
  );
  caseWrite(
    openApiRoutes.removeCaseAsset,
    caseRoutes.removeCaseAsset.body,
    (files, id, { assetId }) => files.removeAsset(id, assetId),
  );
  caseWrite(
    openApiRoutes.setCaseAssetOwner,
    caseRoutes.setCaseAssetOwner.body,
    (files, id, request) => files.setOwner(id, request),
  );
  caseWrite(
    openApiRoutes.confirmCaseAssetOwner,
    caseRoutes.confirmCaseAssetOwner.body,
    (files, id, request) => files.confirmOwner(id, request),
  );
  caseWrite(
    openApiRoutes.removeCaseAssetOwner,
    caseRoutes.removeCaseAssetOwner.body,
    (files, id, request) => files.removeOwner(id, request),
  );
  v1.openapi(openApiRoutes.getCaseQuestions, async (c) => {
    const account = await caseAccount(c, false);
    if ('refused' in account) return account.refused;
    const questions = await account.cases.questions(account.current.accountId);
    return questions === null ? fail(c, 'not_found', 404) : c.json(questions, 200);
  });
  v1.openapi(openApiRoutes.getCasePlayback, async (c) => {
    const account = await caseAccount(c, 'playback');
    if ('refused' in account) return account.refused;
    const playback = await account.cases.playback(account.current.accountId);
    return playback === null ? fail(c, 'not_found', 404) : c.json(playback, 200);
  });
  v1.openapi(openApiRoutes.getCaseEvaluations, async (c) => {
    const account = await caseAccount(c, 'evaluations');
    if ('refused' in account) return account.refused;
    const evaluations = await account.cases.evaluations(account.current.accountId);
    return evaluations === null
      ? fail(c, 'not_found', 404)
      : c.json(CaseEvaluations.parse(evaluations), 200);
  });
  v1.openapi(openApiRoutes.reportRule, async (c) => {
    const account = await caseAccount(c, 'reports');
    if ('refused' in account) return account.refused;
    const request = caseRoutes.reportRule.body.parse(await c.req.json());
    const outcome = await account.cases.reportRule(account.current.accountId, request);
    return outcome === 'reported' ? c.json({}, 200) : fail(c, 'not_found', 404);
  });
  caseWrite(
    openApiRoutes.answerCaseQuestions,
    caseRoutes.answerCaseQuestions.body,
    (files, id, request) => files.answerQuestions(id, request),
  );
  v1.openapi(openApiRoutes.leaveCase, async (c) => {
    const account = await caseAccount(c, 'write');
    if ('refused' in account) return account.refused;
    if (!(await stepUpGranted(c, account.current, 'sensitive_settings', leaveCaseAction))) {
      return fail(c, 'step_up_required', 403);
    }
    const outcome = await account.cases.leave(account.current.accountId);
    return outcome === 'left' ? c.json({}, 200) : fail(c, 'not_found', 404);
  });

  const refusedDecision = {
    not_approver: 403,
    step_up_required: 403,
    not_found: 404,
    already_rejected: 409,
  } as const;
  const decided = (c: Context<AppEnv>, outcome: DecisionOutcome) =>
    'decided' in outcome
      ? c.json({ decisionId: outcome.decided }, 200)
      : fail(c, outcome.refused, refusedDecision[outcome.refused]);
  const decideVersion = async (c: Context<AppEnv>, kind: DecisionKind) => {
    const current = await signedIn(c);
    if (current === null || knowledge === undefined) return unauthorized(c);
    // Before the body or the nonce is read, so anyone else learns only that they may not decide;
    // the service checks again, as the authority.
    if (!knowledge.isApprover(current.accountId)) return fail(c, 'not_approver', 403);
    const version = DecideVersionRequest.parse(await c.req.json());
    const nonce = actionNonce(c);
    if (nonce === undefined) return fail(c, 'step_up_required', 403);
    return decided(c, await knowledge.decide(current, kind, version, nonce));
  };
  /** The approver's reads; anyone else learns only that they may not decide. */
  const approverReads = async (c: Context<AppEnv>) => {
    const current = await signedIn(c);
    if (current === null || knowledge === undefined || knowledgeVersions === undefined) {
      return { refused: unauthorized(c) };
    }
    if (!knowledge.isApprover(current.accountId)) {
      return { refused: fail(c, 'not_approver', 403) };
    }
    return { versions: knowledgeVersions };
  };
  v1.openapi(openApiRoutes.listKnowledgeVersions, async (c) => {
    const reads = await approverReads(c);
    if ('refused' in reads) return reads.refused;
    return c.json({ versions: [...(await reads.versions.list())] }, 200);
  });
  v1.openapi(openApiRoutes.getVersionView, async (c) => {
    const reads = await approverReads(c);
    if ('refused' in reads) return reads.refused;
    const { routeId, number } = VersionViewQuery.parse(c.req.query());
    const view = await reads.versions.view(routeId, number);
    return view === undefined ? fail(c, 'not_found', 404) : c.json(VersionView.parse(view), 200);
  });
  const reportReview = async (c: Context<AppEnv>) => {
    const reads = await approverReads(c);
    if ('refused' in reads) return { refused: reads.refused };
    return ruleReports === undefined ? { refused: unauthorized(c) } : { reports: ruleReports };
  };
  v1.openapi(openApiRoutes.listRuleReports, async (c) => {
    const review = await reportReview(c);
    if ('refused' in review) return review.refused;
    return c.json({ reports: await review.reports.open() }, 200);
  });
  v1.openapi(openApiRoutes.closeRuleReports, async (c) => {
    const review = await reportReview(c);
    if ('refused' in review) return review.refused;
    const request = CloseRuleReportsRequest.parse(await c.req.json());
    return c.json({ closed: await review.reports.close(request) }, 200);
  });
  v1.openapi(openApiRoutes.activateVersion, (c) => decideVersion(c, 'activate'));
  v1.openapi(openApiRoutes.rejectVersion, (c) => decideVersion(c, 'reject'));

  v1.openapi(openApiRoutes.notificationChannels, async (c) => {
    const current = await signedIn(c);
    if (current === null || notifications === undefined) return unauthorized(c);
    const channels = await notifications.channels.list(current.accountId);
    return c.json({ channels, pushKey: notifications.pushKey }, 200);
  });

  v1.openapi(openApiRoutes.addPushChannel, async (c) => {
    const current = await signedIn(c);
    if (current === null || notifications === undefined || authLimits === undefined) {
      return unauthorized(c);
    }
    const limited = await overLimit(
      c,
      authLimits,
      notificationLimits.addPushChannel,
      current.accountId,
    );
    if (limited !== undefined) return limited;
    const subscription = addPushChannel.body.parse(await c.req.json());
    if (!isP256PublicKey(subscription.p256dh)) return fail(c, 'invalid_request', 400);
    if (notifications.pushKey === null) return fail(c, 'push_unavailable', 503);
    const outcome = await notifications.channels.addPush(
      current.accountId,
      subscription,
      describeDevice(c.req.header('user-agent')),
    );
    if (outcome === 'too_many') return fail(c, 'too_many_push_channels', 409);
    return c.json(outcome, 200);
  });

  // A stolen session must not silence a channel (spec 0005, R7).
  v1.openapi(openApiRoutes.removeNotificationChannel, async (c) => {
    const current = await signedIn(c);
    if (current === null || notifications === undefined) return unauthorized(c);
    const { channelId } = removeNotificationChannel.body.parse(await c.req.json());
    const approved = await stepUpGranted(c, current, 'sensitive_settings', {
      action: removeNotificationChannel.operationId,
      targets: [channelId],
    });
    if (!approved) return fail(c, 'step_up_required', 403);
    if (!(await notifications.channels.removePush(current.accountId, channelId))) {
      return fail(c, 'not_found', 404);
    }
    return c.json({}, 200);
  });

  // No step-up: only the subscribed browser holds the auth secret, so it can only give up its own.
  v1.openapi(openApiRoutes.forgetPushChannel, async (c) => {
    const current = await signedIn(c);
    if (current === null || notifications === undefined || authLimits === undefined) {
      return unauthorized(c);
    }
    const limited = await overLimit(
      c,
      authLimits,
      notificationLimits.forgetPushChannel,
      current.accountId,
    );
    if (limited !== undefined) return limited;
    const subscription = forgetPushChannel.body.parse(await c.req.json());
    if (!(await notifications.channels.forgetPush(current.accountId, subscription))) {
      return fail(c, 'not_found', 404);
    }
    return c.json({}, 200);
  });

  app.route(apiBasePath, v1);

  // Only allow-listed Better Auth endpoints reach it (spec 0003, R1). The match is on the exact
  // method and the raw path Better Auth will route on, so no encoding or extra segment slips by.
  const allowed = new Map<string, { route: RouteDefinition; limit: RateLimitRule }>(
    authRoutes.map((route) => [
      routeKey(route),
      { route, limit: authRouteLimits[route.operationId] },
    ]),
  );
  app.all(`${authBasePath}/*`, async (c) => {
    const match = allowed.get(`${c.req.method} ${new URL(c.req.url).pathname}`);
    if (auth === undefined || authLimits === undefined || match === undefined) {
      return reject(c, 'not_found', 404);
    }
    // Counted only for this site's own pages: a cross-site page loading the options URL (an
    // image tag needs no Origin) would otherwise spend the budget of everyone behind its NAT.
    // Clients that send no Sec-Fetch-Site, such as native apps, are counted as usual.
    const site = c.req.header('sec-fetch-site');
    if (site !== undefined && site !== 'same-origin') return reject(c, 'cross_origin', 403);
    const { route, limit } = match;
    const limited = await overLimit(
      c,
      authLimits,
      limit,
      authLimits.clientAddress(c.req.raw.headers),
    );
    if (limited !== undefined) return limited;
    if (route.body !== undefined && !route.body.safeParse(await bodyOf(c.req.raw)).success) {
      return reject(c, 'invalid_request', 400);
    }
    return throughContract(c, route, await auth.handle(c.req.raw));
  });

  app.get('/.well-known/security.txt', (c) =>
    c.text(securityTxt(), 200, { 'Cache-Control': 'public, max-age=86400' }),
  );

  if (outbox !== undefined) {
    app.get('/internal/outbox', async (c) => c.json({ messages: await outbox() }, 200));
  }

  if (memoryObjects !== undefined) {
    const objectPath = (c: Context<AppEnv>) => c.req.path.slice(`${memoryObjectsPath}/`.length);
    app.put(`${memoryObjectsPath}/*`, async (c) => {
      const body = new Uint8Array(await c.req.arrayBuffer());
      const stored = memoryObjects.receive(objectPath(c), c.req.query('token') ?? '', body);
      return stored ? c.body(null, 204) : reject(c, 'not_found', 404);
    });
    app.get(`${memoryObjectsPath}/*`, (c) => {
      const bytes = memoryObjects.serve(objectPath(c), c.req.query('token') ?? '');
      if (bytes === undefined) return reject(c, 'not_found', 404);
      return c.body(new Uint8Array(bytes), 200, {
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store',
      });
    });
  }

  if (syntheticError) {
    app.get('/internal/monitoring-check', () => {
      throw new SyntheticPersonalDataError();
    });
  }

  if (tunnel !== undefined && authLimits !== undefined) {
    const limited = (rule: RateLimitRule) =>
      createMiddleware<AppEnv>(async (c, next) => {
        const refused = await overAddressLimit(c, authLimits, rule);
        if (refused !== undefined) return refused;
        return next();
      });
    /** Hono's body limit replaces a streamed request, and with it the platform's `waitUntil`. */
    const capped = (maxSize: number) => [
      createMiddleware<AppEnv>(async (c, next) => {
        c.set(
          'behind',
          behindAnswerOf(c.req.raw, () => {
            logger.error({ errorName: 'BehindAnswerUnavailable' });
          }),
        );
        return next();
      }),
      bodyLimit({ maxSize, onError: (c: Context<AppEnv>) => reject(c, 'too_large', 413) }),
    ];
    /** Answers at once and forwards behind the answer; a failure is logged by class only. */
    const forwarded = (c: Context<AppEnv>, work: Promise<void> | null) => {
      if (work === null) return reject(c, 'invalid_request', 400);
      const route = routePath(c);
      c.get('behind')?.(
        work.catch((error: unknown) => {
          logger.error({
            route,
            errorName: error instanceof Error ? error.name : 'NonErrorThrown',
          });
        }),
      );
      return c.body(null, 204);
    };

    app.post(
      tunnelPath,
      sameOrigin(origin),
      limited(monitoringLimits.envelope),
      ...capped(200 * 1024),
      async (c) => forwarded(c, tunnel.envelope(await c.req.text())),
    );
    // The Reporting API sends from the browser itself, with no Origin to check.
    app.post(
      cspReportPath,
      limited(monitoringLimits.cspReports),
      ...capped(64 * 1024),
      async (c) => {
        const body = await c.req.text();
        let payload: unknown;
        try {
          payload = JSON.parse(body);
        } catch {
          return reject(c, 'invalid_request', 400);
        }
        return forwarded(c, tunnel.cspReports(payload));
      },
    );
  }

  // Vercel cron sends GET with `Authorization: Bearer <CRON_SECRET>` (spec 0001, R6). Not part of
  // the OpenAPI document, and the only routes that start workflows.
  if (cron !== undefined) {
    const {
      readSecret,
      startHeartbeat,
      startRetention,
      startDueErasures,
      sweepRateLimits,
      clock = () => new Date(),
    } = cron;
    const fromCron = createMiddleware<AppEnv>(async (c, next) => {
      if (!bearerMatches(c.req.header('authorization'), readSecret())) {
        return reject(c, 'unauthorized', 401);
      }
      return next();
    });
    app.get('/internal/cron/heartbeat', fromCron, async (c) => {
      await startHeartbeat(utcDate(clock()));
      return c.body(null, 202);
    });
    app.get('/internal/cron/retention', fromCron, async (c) => {
      await startRetention(utcDate(clock()));
      return c.body(null, 202);
    });
    app.get('/internal/cron/account-erasure', fromCron, async (c) => {
      await startDueErasures();
      return c.body(null, 202);
    });
    // A single idempotent delete, so it runs inline instead of as a workflow.
    app.get('/internal/cron/rate-limit-sweep', fromCron, async (c) => {
      await sweepRateLimits();
      return c.body(null, 204);
    });
  }
  return app;
}

export type App = ReturnType<typeof createApp>;
