import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fallbackExclusions, securityHeaders } from '@arca/security-policy';
import { defineConfig } from 'nitro';

// apps/web's static build, served from the same origin as the API (spec 0001, R4).
const webDist = fileURLToPath(new URL('../web/dist/', import.meta.url));

// The pooled host and database name, written at build time by `pnpm --filter @arca/scripts
// db:runtime-config` from the owner's variables, which runtime code may not read (spec 0001, R7).
// Absent locally, so the health check reports the database as unavailable.
const databaseFile = new URL('./generated/database.json', import.meta.url);
const database: unknown = existsSync(databaseFile)
  ? JSON.parse(readFileSync(databaseFile, 'utf8'))
  : {};

// The API answers every path under the excluded prefixes, with a 404 for unknown ones; every other
// path that is not a static file gets the SPA's index.html (spec 0001, R4). These are routes, not
// a server entry: Nitro would pass a 404 from a server entry on to the renderer.
const apiHandler = './src/server.ts';
const routes = Object.fromEntries(
  fallbackExclusions.flatMap((prefix) => [
    [prefix, apiHandler],
    [`${prefix}/**`, apiHandler],
  ]),
);

export default defineConfig({
  compatibilityDate: '2026-11-01',
  serverEntry: false,
  routes,
  errorHandler: './src/error-handler.ts',
  plugins: ['./src/quiet-errors.ts'],
  // Dotfiles such as a stray .tsbuildinfo are never published.
  publicAssets: [{ dir: webDist, baseURL: '/', ignore: ['**/.*'] }],
  renderer: { template: join(webDist, 'index.html'), static: true },
  routeRules: { '/**': { headers: { ...securityHeaders } } },
  runtimeConfig: { database },
  vercel: { functions: { regions: ['gru1'], runtime: 'nodejs26.x' } },
});
