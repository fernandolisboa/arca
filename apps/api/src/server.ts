import { createI18n } from '@arca/i18n';
import { useRuntimeConfig } from 'nitro/runtime-config';
import { createApp } from './app.js';
import { auditLog, auditReader } from './audit/log.js';
import { createAuth, credentialStore } from './auth/auth.js';
import { rateLimiter, type RateLimiter } from './auth/rate-limit.js';
import { clientAddressFor } from './client-address.js';
import { createEnrollment, ownerCode, type Enrollment } from './auth/enrollment.js';
import { createInvites, type Invites } from './auth/invites.js';
import { recoveryKits, type RecoveryKits } from './auth/recovery-kit.js';
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
  readRateLimitKey,
} from './config.js';
import { apiDatabase, auditDatabase, authDatabase } from './database.js';
import { emailSenderFor, outboxReaderFor } from './email/environment.js';
import { createNotices } from './email/notices.js';
import { createLogger } from './logger.js';
import { heartbeat } from './workflows/heartbeat.js';
import { startWorkflow } from './workflows/start-workflow.js';

const logger = createLogger();

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
}

let parts: Promise<AuthParts> | undefined;

/** Better Auth and the routes beside it on the app_auth pool, built on the first auth request. */
function authParts(): Promise<AuthParts> {
  parts ??= (async () => {
    const target = databaseTargetFrom(useRuntimeConfig()['database']);
    const audit = auditLog(auditDatabase(target, readAuditDatabasePassword(), logger).db);
    const origin = readAuthOrigin();
    const email = emailSenderFor(environment, authConnection);
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
    const invites = createInvites({ db, audit, email, notices, i18n, origin, logger });
    return {
      auth: authService(auth),
      stepUp: createStepUp({ db, credentials: credentialStore(db), audit, origin, logger }),
      enrollment: createEnrollment({ db, email, i18n, origin, ownerCode: enrollmentCode }),
      registration: registration(auth, hooks, enrollmentCode, logger, invites.accepted),
      recoveryKits: recoveryKits({ db, audit, notices, logger }),
      invites,
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
function ownOrigin(): string | undefined {
  try {
    return readAuthOrigin();
  } catch {
    return undefined;
  }
}

const withOrigin = (origin: string | undefined) => (origin === undefined ? {} : { origin });

const outbox = outboxReaderFor(environment, authConnection);

const app = createApp({
  checkDatabase: () => connected().checkDatabase(),
  logger,
  cron: {
    readSecret: readCronSecret,
    startHeartbeat: (runDate) => startWorkflow(heartbeat, [runDate]),
    sweepRateLimits: () => limiter.sweep(),
  },
  ...withOrigin(ownOrigin()),
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
  authLimits: {
    limiter,
    clientAddress: clientAddressFor(environment, () => {
      logger.error({ errorName: 'ClientAddressUnknown' });
    }),
  },
  audit: { events: (accountId, query) => auditReader(connected().db).events(accountId, query) },
  ...(outbox === undefined ? {} : { outbox }),
});

/**
 * The Nitro route for the API and the other paths that never fall back to the SPA (see
 * nitro.config.ts): unknown paths get the API's JSON 404.
 */
export default { fetch: (request: Request) => app.fetch(request) };
