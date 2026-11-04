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
import { readOutbox } from './email/outbox.js';
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

let auth: AuthService | undefined;

/** Better Auth on its own app_auth pool, built on the first auth request. */
function authenticator(): AuthService {
  if (auth === undefined) {
    const target = databaseTargetFrom(useRuntimeConfig()['database']);
    const audit = auditLog(auditDatabase(target, readAuditDatabasePassword(), logger).db);
    auth = authService(
      createAuth({
        db: authConnection(),
        secret: readAuthSecrets().secret,
        origin: readAuthOrigin(),
        logger,
        audit,
      }),
    );
  }
  return auth;
}

const environment = readDeploymentEnvironment();

const app = createApp({
  checkDatabase: () => connected().checkDatabase(),
  logger,
  cron: {
    readSecret: readCronSecret,
    startHeartbeat: (runDate) => startWorkflow(heartbeat, [runDate]),
  },
  auth: {
    handle: (request) => authenticator().handle(request),
    session: (headers) => authenticator().session(headers),
  },
  audit: { events: (accountId, query) => auditReader(connected().db).events(accountId, query) },
  ...(environment === 'preview' ? { outbox: () => readOutbox(authConnection(), environment) } : {}),
});

/**
 * The Nitro route for the API and the other paths that never fall back to the SPA (see
 * nitro.config.ts): unknown paths get the API's JSON 404.
 */
export default { fetch: (request: Request) => app.fetch(request) };
