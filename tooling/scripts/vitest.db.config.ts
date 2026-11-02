import { defineConfig } from 'vitest/config';

// Against a disposable Postgres 18 server (ARCA_TEST_DB_* variables). The files share its roles,
// so they run one at a time.
export default defineConfig({
  test: {
    include: ['test/db/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
