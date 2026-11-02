import { defineConfig, devices } from '@playwright/test';

const port = 4173;
const ci = process.env['CI'] !== undefined;
/** Optional: a local Chromium when the installed one does not match Playwright's revision. */
const executablePath = process.env['ARCA_E2E_CHROMIUM'];

/**
 * End-to-end tests against the built app served locally: the Nitro server from apps/api with
 * this app's static build, at phone and desktop sizes (spec 0001, R8). It runs with no database,
 * so the API reports itself degraded.
 */
export default defineConfig({
  testDir: '.',
  forbidOnly: ci,
  reporter: ci ? [['github'], ['list']] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${String(port)}`,
    launchOptions: executablePath === undefined ? {} : { executablePath },
  },
  projects: [
    {
      name: 'phone',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'node ../../api/.output/server/index.mjs',
    url: `http://127.0.0.1:${String(port)}/`,
    env: { PORT: String(port), HOST: '127.0.0.1' },
    reuseExistingServer: false,
  },
});
