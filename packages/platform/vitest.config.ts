import { defineConfig } from 'vitest/config';

// Unit tests only; the Playwright suite in e2e/ has its own runner.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
