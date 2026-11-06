import { configDefaults, defineConfig } from 'vitest/config';

// Typed linting starts a TypeScript project service per fixture directory, which is slow on a cold cache.
// Fixtures are linted, never run, even those named like the test files they stand for.
export default defineConfig({
  test: { testTimeout: 30_000, exclude: [...configDefaults.exclude, 'test/fixtures/**'] },
});
