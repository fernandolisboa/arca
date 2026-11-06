import { defineConfig } from 'vitest/config';

// The intake evaluation (spec 0008, R5): calls the real model, so only `pnpm eval:intake` runs it,
// by hand or from the manual intake-eval workflow; never part of `pnpm test`.
export default defineConfig({
  test: {
    include: ['test/eval/**/*.eval.ts'],
    testTimeout: 15 * 60_000,
  },
});
