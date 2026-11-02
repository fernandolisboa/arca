import { useRuntimeConfig } from 'nitro/runtime-config';
import { createApp } from './app.js';
import { databaseTargetFrom, readApiSecrets } from './config.js';
import { apiDatabase } from './database.js';
import { createLogger } from './logger.js';

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

const app = createApp({ checkDatabase: () => connected().checkDatabase(), logger });

/**
 * The Nitro route for the API and the other paths that never fall back to the SPA (see
 * nitro.config.ts): unknown paths get the API's JSON 404.
 */
export default { fetch: (request: Request) => app.fetch(request) };
