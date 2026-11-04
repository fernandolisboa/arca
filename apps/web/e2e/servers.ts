/** The server with no database, so the API reports itself degraded. */
export const signedOutOrigin = 'http://127.0.0.1:4173';

const name = process.env['ARCA_E2E_DATABASE'] ?? '';

/**
 * The server with a database, when ARCA_E2E_DATABASE names one on the disposable Postgres server
 * of the database tests (ARCA_TEST_DB_* variables). WebAuthn needs a host name, not an address, so
 * the browser reaches it as localhost, the relying party ID the API derives from its origin.
 */
export const databaseServer = {
  enabled: name !== '',
  origin: 'http://localhost:4174',
  rpId: 'localhost',
  database: {
    host: process.env['ARCA_TEST_DB_HOST'] ?? '127.0.0.1',
    // The API always connects on 5432 (databaseTargetFrom in apps/api).
    port: 5432,
    name,
  },
} as const;
