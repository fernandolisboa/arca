import { defineConfig } from 'vitest/config';

// The AI evaluations (spec 0008, R5; ADR-0025; ADR-0027) call the real model, so only
// `pnpm eval:intake`, `pnpm eval:rule-summary` and `pnpm eval:independent-check` run them, by hand or
// from the manual intake-eval workflow; never part of `pnpm test`.
export default defineConfig({
  test: {
    include: ['test/eval/**/*.eval.ts'],
    testTimeout: 15 * 60_000,
  },
});
