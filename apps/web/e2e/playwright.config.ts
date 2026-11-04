import { defineConfig, devices } from '@playwright/test';
import { databaseServer, signedOutOrigin } from './servers.js';

const ci = process.env['CI'] !== undefined;
/** Optional: a local Chromium when the installed one does not match Playwright's revision. */
const executablePath = process.env['ARCA_E2E_CHROMIUM'];
const withDatabase = databaseServer.enabled;
if (ci && !withDatabase) {
  throw new Error('CI runs the sign-in tests, so ARCA_E2E_DATABASE must name a database');
}

const server = 'node ../../api/.output/server/index.mjs';

/**
 * End-to-end tests against the built app served locally: the Nitro server from apps/api with
 * this app's static build, at phone and desktop sizes (spec 0001, R8). One server runs with no
 * database, so the API reports itself degraded; with ARCA_E2E_DATABASE=1, a second one reaches
 * the Postgres the PG* variables name, for the sign-in tests (spec 0003, R3).
 */
export default defineConfig({
  testDir: '.',
  forbidOnly: ci,
  reporter: ci ? [['github'], ['list']] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: signedOutOrigin,
    launchOptions: executablePath === undefined ? {} : { executablePath },
  },
  projects: [
    {
      name: 'phone',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    {
      command: server,
      url: `${signedOutOrigin}/`,
      env: { PORT: '4173', HOST: '127.0.0.1' },
      reuseExistingServer: false,
    },
    ...(withDatabase
      ? [
          {
            command: server,
            url: 'http://127.0.0.1:4174/',
            env: {
              PORT: '4174',
              HOST: '127.0.0.1',
              ARCA_LOCAL_ORIGIN: databaseServer.origin,
              // Nitro overrides the built runtime config from NITRO_* variables at start.
              NITRO_DATABASE_HOST: databaseServer.database.host,
              NITRO_DATABASE_NAME: databaseServer.database.name,
            },
            reuseExistingServer: false,
          },
        ]
      : []),
  ],
});
