import { configDefaults, defineConfig } from 'vitest/config';

// The database tests need a Postgres server and run separately (vitest.db.config.ts).
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, 'test/db/**'] },
});
