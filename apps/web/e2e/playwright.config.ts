import { defineConfig, devices } from '@playwright/test';
import { databaseServer, e2eEnrollmentCodeHash, signedOutOrigin } from './servers.js';

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
 * this app's static build, at phone and desktop sizes (spec 0001, R8); the shell and accessibility
 * suites set their own widths, tablet included (spec 0006, R11). One server runs with no
 * database, so the API reports itself degraded. When ARCA_E2E_DATABASE names a database on the
 * ARCA_TEST_DB_* server, a second one reaches it, for the enrollment and sign-in tests (spec 0003,
 * R2 and R3); enrollment runs first, while the database holds no account.
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
    // The first account is created once per database, before any other test seeds an account.
    { name: 'enrollment', testMatch: 'enrollment.spec.ts' },
    {
      name: 'phone',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
      testIgnore: 'enrollment.spec.ts',
      dependencies: ['enrollment'],
    },
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 800 } },
      testIgnore: 'enrollment.spec.ts',
      dependencies: ['enrollment'],
    },
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
              ARCA_ENROLLMENT_CODE_HASH: e2eEnrollmentCodeHash,
              ARCA_INTAKE_EXTRACTOR: 'scripted',
              ARCA_RULE_SUMMARIZER: 'scripted',
            },
            reuseExistingServer: false,
          },
        ]
      : []),
  ],
});
