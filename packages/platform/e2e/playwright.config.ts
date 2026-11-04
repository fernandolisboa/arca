import { env } from 'node:process';
import { defineConfig, devices } from '@playwright/test';

const ci = env['CI'] !== undefined;
/** Optional: a local Chromium when the installed one does not match Playwright's revision. */
const executablePath = env['ARCA_E2E_CHROMIUM'];

/**
 * The web adapters against the conformance suites in a real browser (spec 0005, R5). Pages are
 * served by request interception from the built package, so no server runs.
 */
export default defineConfig({
  testDir: '.',
  forbidOnly: ci,
  reporter: ci ? [['github'], ['list']] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    launchOptions: executablePath === undefined ? {} : { executablePath },
  },
});
