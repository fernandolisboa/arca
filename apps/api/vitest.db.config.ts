import { defineConfig } from 'vitest/config';

// Against a disposable Postgres server (ARCA_TEST_DB_* variables), like packages/db.
export default defineConfig({
  test: {
    include: ['test/postgres/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
