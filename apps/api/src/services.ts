import { createI18n } from '@arca/i18n';
import { useRuntimeConfig } from 'nitro/runtime-config';
import { auditLog } from './audit/log.js';
import { createAuth, credentialStore } from './auth/auth.js';
import { createDevices, type Devices } from './auth/devices.js';
import { createEnrollment, ownerCode, type Enrollment } from './auth/enrollment.js';
import { createInvites, type Invites } from './auth/invites.js';
import { rateLimiter, type RateLimiter } from './auth/rate-limit.js';
import { recoveryKits, type RecoveryKits } from './auth/recovery-kit.js';
import { createRecovery, type RecoveryService } from './auth/recovery.js';
import { registration, registrationHooks, type Registration } from './auth/registration.js';
import { authService, type AuthService } from './auth/service.js';
import { createStepUp, type StepUpService } from './auth/step-up.js';
import {
  databaseTargetFrom,
  readApiSecrets,
  readAuditDatabasePassword,
  readAuthOrigin,
  readAuthSecrets,
  readDeploymentEnvironment,
  readEnrollmentCodeHash,
  readRateLimitKey,
} from './config.js';
import { apiDatabase, auditDatabase, authDatabase } from './database.js';
import { accountsOpenWith, emailRouteFor, emailSenderFor } from './email/environment.js';
import { createNotices } from './email/notices.js';
import { stdoutLogger } from './logger.js';
import { recoveryLink } from './workflows/recovery-link.js';
import { startWorkflow } from './workflows/start-workflow.js';
import { entityId } from './workflows/workflow-arguments.js';

/**
 * The deployment's connections and auth services, built lazily, shared by the API's routes and
 * the workflow steps that need the same services.
 */

export const logger = stdoutLogger();

let database: ReturnType<typeof apiDatabase> | undefined;

/**
 * Connects on first use, so a missing setting surfaces as an unavailable database in
 * `GET /v1/health` instead of failing every request, the static shell included.
 */
export function connected() {
  database ??= apiDatabase(
    databaseTargetFrom(useRuntimeConfig()['database']),
    readApiSecrets().databasePassword,
    logger,
  );
  return database;
}

let authPool: ReturnType<typeof authDatabase> | undefined;

/** The app_auth pool, shared by Better Auth and the outbox. */
export function authConnection() {
  authPool ??= authDatabase(
    databaseTargetFrom(useRuntimeConfig()['database']),
    readAuthSecrets().databasePassword,
    logger,
  );
  return authPool.db;
}

export const environment = readDeploymentEnvironment();
const emailRoute = emailRouteFor(environment);
export const accountsOpen = accountsOpenWith(emailRoute);

let limiterInstance: RateLimiter | undefined;

/**
 * The auth routes' counters, on the app_auth pool, keyed by the environment's HMAC key; built on
 * first use, so a missing key fails the auth routes, not the whole server.
 */
export const limiter: RateLimiter = {
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
  readonly recovery: RecoveryService;
}

let parts: Promise<AuthParts> | undefined;

/** Better Auth and the routes beside it on the app_auth pool, built on the first auth request. */
export function authParts(): Promise<AuthParts> {
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
    const invites = createInvites({ db, audit, email, notices, i18n, origin, logger });
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
        deliver: async (accountId) => {
          await startWorkflow(recoveryLink, [entityId(accountId)]);
        },
      }),
    };
  })();
  // A failed build is retried on the next request instead of being cached.
  parts.catch(() => {
    parts = undefined;
  });
  return parts;
}
