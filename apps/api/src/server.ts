import { createI18n, type I18n } from '@arca/i18n';
import { useRuntimeConfig } from 'nitro/runtime-config';
import { createDataExports } from './account/data-export.js';
import { createAccountDeletion, type AccountDeletion } from './account/deletion.js';
import { forEachAccount } from './account/each-account.js';
import { accounts } from './auth/auth.js';
import { createApp } from './app.js';
import { auditLog, auditReader, type AuditLog } from './audit/log.js';
import { createAuth, credentialStore } from './auth/auth.js';
import { rateLimiter, type RateLimiter } from './auth/rate-limit.js';
import { clientAddressFor } from './client-address.js';
import { createEnrollment, ownerCode, type Enrollment } from './auth/enrollment.js';
import { createDevices, type Devices } from './auth/devices.js';
import { createInvites, type Invites } from './auth/invites.js';
import { recoveryKits, type RecoveryKits } from './auth/recovery-kit.js';
import { createRecovery, type Recovery } from './auth/recovery.js';
import { registration, registrationHooks, type Registration } from './auth/registration.js';
import { authService, type AuthService } from './auth/service.js';
import { createStepUp, type StepUpService } from './auth/step-up.js';
import {
  databaseTargetFrom,
  readApiSecrets,
  readAuditDatabasePassword,
  readAuthOrigin,
  readAuthSecrets,
  readCronSecret,
  readDeploymentEnvironment,
  readEnrollmentCodeHash,
  readOwnOrigin,
  readRateLimitKey,
} from './config.js';
import { apiDatabase, auditDatabase, authDatabase } from './database.js';
import {
  accountsOpenWith,
  emailRouteFor,
  emailSenderFor,
  outboxReaderFor,
} from './email/environment.js';
import { createNotices } from './email/notices.js';
import { stdoutLogger } from './logger.js';
import { monitorRequests, sendToSentry, startMonitoring, tunnelFor } from './monitoring.js';
import { enforceRetention } from './workflows/enforce-retention.js';
import { eraseAccount } from './workflows/erase-account.js';
import { heartbeat } from './workflows/heartbeat.js';
import { startWorkflow } from './workflows/start-workflow.js';
import { entityId } from './workflows/workflow-arguments.js';

const logger = stdoutLogger();

let database: ReturnType<typeof apiDatabase> | undefined;

/**
 * Connects on first use, so a missing setting surfaces as an unavailable database in
 * `GET /v1/health` instead of failing every request, the static shell included.
 */
function connected() {
  database ??= apiDatabase(
    databaseTargetFrom(useRuntimeConfig()['database']),
    readApiSecrets().databasePassword,
    logger,
  );
  return database;
}

let authPool: ReturnType<typeof authDatabase> | undefined;

/** The app_auth pool, shared by Better Auth and the outbox. */
function authConnection() {
  authPool ??= authDatabase(
    databaseTargetFrom(useRuntimeConfig()['database']),
    readAuthSecrets().databasePassword,
    logger,
  );
  return authPool.db;
}

const environment = readDeploymentEnvironment();
const emailRoute = emailRouteFor(environment);
const accountsOpen = accountsOpenWith(emailRoute);

let limiterInstance: RateLimiter | undefined;

/**
 * The auth routes' counters, on the app_auth pool, keyed by the environment's HMAC key; built on
 * first use, so a missing key fails the auth routes, not the whole server.
 */
const limiter: RateLimiter = {
  hit: (rule, subject) => built().hit(rule, subject),
  sweep: () => built().sweep(),
};

function built(): RateLimiter {
  limiterInstance ??= rateLimiter({ db: authConnection(), key: readRateLimitKey() });
  return limiterInstance;
}

interface AuthParts {
  readonly auth: AuthService;
  readonly stepUp: StepUpService;
  readonly enrollment: Enrollment;
  readonly registration: Registration;
  readonly recoveryKits: RecoveryKits;
  readonly invites: Invites;
  readonly devices: Devices;
  readonly recovery: Recovery;
  readonly audit: AuditLog;
  readonly i18n: I18n;
  readonly accountDeletion: AccountDeletion;
}

let parts: Promise<AuthParts> | undefined;

/** Better Auth and the routes beside it on the app_auth pool, built on the first auth request. */
function authParts(): Promise<AuthParts> {
  parts ??= (async () => {
    const target = databaseTargetFrom(useRuntimeConfig()['database']);
    const audit = auditLog(auditDatabase(target, readAuditDatabasePassword(), logger).db);
    const origin = readAuthOrigin();
    const email = emailSenderFor(emailRoute, environment, authConnection);
    const i18n = await createI18n();
    const notices = createNotices({ email, i18n, origin });
    const db = authConnection();
    const enrollmentCode = ownerCode(readEnrollmentCodeHash(environment));
    const hooks = registrationHooks({ db, audit, ownerCode: enrollmentCode });
    const auth = createAuth({
      db,
      secret: readAuthSecrets().secret,
      origin,
      logger,
      audit,
      notices,
      limiter,
      registration: hooks,
    });
    const invites = createInvites({
      db,
      audit,
      email,
      notices,
      i18n,
      origin,
      logger,
      startErasure: (id) => startWorkflow(eraseAccount, [entityId(id)]),
    });
    const devices = createDevices({ db, audit, notices, logger, origin });
    return {
      auth: authService(auth),
      stepUp: createStepUp({ db, credentials: credentialStore(db), audit, origin, logger }),
      enrollment: createEnrollment({ db, email, i18n, origin, ownerCode: enrollmentCode }),
      registration: registration(auth, hooks, enrollmentCode, logger, invites.accepted),
      recoveryKits: recoveryKits({ db, audit, notices, logger }),
      invites,
      devices,
      recovery: createRecovery({
        db,
        audit,
        email,
        notices,
        i18n,
        origin,
        logger,
        emailAvailable: accountsOpen,
        status: devices.status,
      }),
      audit,
      i18n,
      accountDeletion: createAccountDeletion({ db, audit, notices, logger }),
    };
  })();
  // A failed build is retried on the next request instead of being cached.
  parts.catch(() => {
    parts = undefined;
  });
  return parts;
}

/**
 * Read once at load, but a missing setting only refuses state-changing requests (the auth routes
 * then fail and log it), so `GET /v1/health` and the static shell keep answering.
 */
const ownOrigin = readOwnOrigin();

const withOrigin = (origin: string | undefined) => (origin === undefined ? {} : { origin });

const outbox = outboxReaderFor(environment, authConnection);

const monitored = startMonitoring({ environment, origin: ownOrigin });
const tunnel = tunnelFor({ environment, origin: ownOrigin, send: sendToSentry });

const app = createApp({
  checkDatabase: () => connected().checkDatabase(),
  logger,
  ...(monitored ? { monitor: monitorRequests } : {}),
  syntheticError: environment === 'preview',
  cron: {
    readSecret: readCronSecret,
    startHeartbeat: (runDate) => startWorkflow(heartbeat, [runDate]),
    startRetention: (runDate) => startWorkflow(enforceRetention, [runDate]),
    // A run per account from this server-side scan; a failed run is started again the next day,
    // since every step is idempotent and an erased account stays noted until its event is recorded.
    startDueErasures: async () =>
      forEachAccount(await accounts.dueForErasure(authConnection()), (id) =>
        startWorkflow(eraseAccount, [entityId(id)]),
      ),
    sweepRateLimits: () => limiter.sweep(),
  },
  ...withOrigin(ownOrigin),
  accountsOpen,
  auth: {
    handle: async (request) => (await authParts()).auth.handle(request),
    signedIn: async (headers) => (await authParts()).auth.signedIn(headers),
    refresh: async (headers) => (await authParts()).auth.refresh(headers),
  },
  stepUp: {
    options: async (signedIn, request) => (await authParts()).stepUp.options(signedIn, request),
    verify: async (signedIn, challengeId, response) =>
      (await authParts()).stepUp.verify(signedIn, challengeId, response),
    consume: async (signedIn, purpose, action) =>
      (await authParts()).stepUp.consume(signedIn, purpose, action),
    vaultUnlocked: async (signedIn) => (await authParts()).stepUp.vaultUnlocked(signedIn),
  },
  enrollment: {
    enrollOwner: async (request) => (await authParts()).enrollment.enrollOwner(request),
  },
  registration: {
    options: async (headers, request) => (await authParts()).registration.options(headers, request),
    verify: async (headers, request) => (await authParts()).registration.verify(headers, request),
  },
  recoveryKits: {
    status: async (accountId) => (await authParts()).recoveryKits.status(accountId),
    issueFirst: async (accountId) => (await authParts()).recoveryKits.issueFirst(accountId),
    regenerate: async (accountId) => (await authParts()).recoveryKits.regenerate(accountId),
    confirm: async (accountId) => (await authParts()).recoveryKits.confirm(accountId),
  },
  invites: {
    create: async (inviterId, email) => (await authParts()).invites.create(inviterId, email),
    list: async (inviterId) => (await authParts()).invites.list(inviterId),
    details: async (token) => (await authParts()).invites.details(token),
    confirm: async (inviterId, inviteId) =>
      (await authParts()).invites.confirm(inviterId, inviteId),
    decline: async (inviterId, inviteId) =>
      (await authParts()).invites.decline(inviterId, inviteId),
    accepted: async (inviteId) => (await authParts()).invites.accepted(inviteId),
  },
  devices: {
    list: async (signedIn) => (await authParts()).devices.list(signedIn),
    revokeSession: async (signedIn, sessionId) =>
      (await authParts()).devices.revokeSession(signedIn, sessionId),
    revokePasskey: async (signedIn, passkeyId) =>
      (await authParts()).devices.revokePasskey(signedIn, passkeyId),
    revokeOtherSessions: async (signedIn) =>
      (await authParts()).devices.revokeOtherSessions(signedIn),
    addOptions: async (signedIn) => (await authParts()).devices.addOptions(signedIn),
    add: async (signedIn, challengeId, response) =>
      (await authParts()).devices.add(signedIn, challengeId, response),
    status: async (accountId) => (await authParts()).devices.status(accountId),
  },
  recovery: {
    start: async (email, behind) => (await authParts()).recovery.start(email, behind),
    redeem: async (token, code) => (await authParts()).recovery.redeem(token, code),
    options: async (token) => (await authParts()).recovery.options(token),
    verify: async (token, response, device) =>
      (await authParts()).recovery.verify(token, response, device),
  },
  authLimits: {
    limiter,
    clientAddress: clientAddressFor(environment, () => {
      logger.error({ errorName: 'ClientAddressUnknown' });
    }),
  },
  audit: { events: (accountId, query) => auditReader(connected().db).events(accountId, query) },
  accountDeletion: {
    request: async (accountId) => (await authParts()).accountDeletion.request(accountId),
    cancel: async (accountId) => (await authParts()).accountDeletion.cancel(accountId),
  },
  dataExports: {
    // Built per export, so a broken app_api setting fails only this route.
    build: async (accountId) => {
      const { audit, i18n } = await authParts();
      return createDataExports({
        authDb: authConnection(),
        apiDb: connected().db,
        audit,
        i18n,
      }).build(accountId);
    },
  },
  ...(outbox === undefined ? {} : { outbox }),
  ...(tunnel === undefined ? {} : { tunnel }),
});

/**
 * The Nitro route for the API and the other paths that never fall back to the SPA (see
 * nitro.config.ts): unknown paths get the API's JSON 404.
 */
export default { fetch: (request: Request) => app.fetch(request) };
