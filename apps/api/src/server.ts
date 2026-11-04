import { createI18n } from '@arca/i18n';
import { useRuntimeConfig } from 'nitro/runtime-config';
import { createApp } from './app.js';
import { auditLog, auditReader } from './audit/log.js';
import { createAuth } from './auth/auth.js';
import { authService, type AuthService } from './auth/service.js';
import {
  databaseTargetFrom,
  readApiSecrets,
  readAuditDatabasePassword,
  readAuthOrigin,
  readAuthSecrets,
  readCronSecret,
  readDeploymentEnvironment,
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

let auth: Promise<AuthService> | undefined;

/** Better Auth on its own app_auth pool, built on the first auth request. */
function authenticator(): Promise<AuthService> {
  auth ??= (async () => {
    const target = databaseTargetFrom(useRuntimeConfig()['database']);
    const audit = auditLog(auditDatabase(target, readAuditDatabasePassword(), logger).db);
    const origin = readAuthOrigin();
    const notices = createNotices({
      email: emailSenderFor(environment, authConnection),
      i18n: await createI18n(),
      origin,
    });
    return authService(
      createAuth({
        db: authConnection(),
        secret: readAuthSecrets().secret,
        origin,
        logger,
        audit,
        notices,
      }),
    );
  })();
  // A failed build is retried on the next request instead of being cached.
  auth.catch(() => {
    auth = undefined;
  });
  return auth;
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
  },
  ...withOrigin(ownOrigin()),
  auth: {
    handle: async (request) => (await authenticator()).handle(request),
    session: async (headers) => (await authenticator()).session(headers),
    refresh: async (headers) => (await authenticator()).refresh(headers),
  },
  audit: { events: (accountId, query) => auditReader(connected().db).events(accountId, query) },
  ...(outbox === undefined ? {} : { outbox }),
});

/**
 * The Nitro route for the API and the other paths that never fall back to the SPA (see
 * nitro.config.ts): unknown paths get the API's JSON 404.
 */
export default { fetch: (request: Request) => app.fetch(request) };
