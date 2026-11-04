import { defineConfig } from 'drizzle-kit';

// No credentials: drizzle-kit only generates SQL here. Migrations are applied by the runner in
// tooling/scripts, as app_migrator, with the guards in the same transaction (spec 0001, R7).
export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/schema.ts',
    './src/auth-schema.ts',
    './src/notice-schema.ts',
    './src/audit-schema.ts',
  ],
  out: './migrations',
});
