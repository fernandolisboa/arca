import { defineConfig } from 'vitest/config';

// Typed linting starts a TypeScript project service per fixture directory, which is slow on a cold cache.
export default defineConfig({ test: { testTimeout: 30_000 } });
