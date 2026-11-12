import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fallbackExclusions, securityHeaders, unpublishedFiles } from '@arca/security-policy';
import workflow from 'workflow/nitro';
import { defineConfig } from 'nitro';

// apps/web's static build, served from the same origin as the API (spec 0001, R4).
const webDist = fileURLToPath(new URL('../web/dist/', import.meta.url));

// The pooled host and database name, written at build time by `pnpm --filter @arca/scripts
// db:runtime-config` from the owner's variables, which runtime code may not read (spec 0001, R7).
// Absent locally, so the health check reports the database as unavailable. The empty keys let
// NITRO_DATABASE_HOST and NITRO_DATABASE_NAME point a local server at a test database (the
// end-to-end sign-in tests), since Nitro overrides only the keys the built config has.
const databaseFile = new URL('./generated/database.json', import.meta.url);
const database: unknown = existsSync(databaseFile)
  ? JSON.parse(readFileSync(databaseFile, 'utf8'))
  : { host: '', name: '' };

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
  // The Workflow SDK's build and routes (spec 0001, R6; ADR-0009). No dashboard: runs are seen in
  // Vercel's, and a local one would serve run data from this origin.
  modules: [workflow],
  workflow: { dirs: ['src/workflows'], dashboard: false, runtime: 'nodejs26.x' },
  publicAssets: [{ dir: webDist, baseURL: '/', ignore: [...unpublishedFiles] }],
  renderer: { template: join(webDist, 'index.html'), static: true },
  routeRules: { '/**': { headers: { ...securityHeaders } } },
  // The independent check reads PDFs with pdf.js in a thread of its own, which imports the library
  // by path at run time (ADR-0028), so the package ships beside the bundle instead of in it.
  traceDeps: ['pdfjs-dist'],
  runtimeConfig: { database },
  vercel: { functions: { regions: ['gru1'], runtime: 'nodejs26.x' } },
});
