import { defineConfig } from 'vitest/config';

// The AI evaluations (spec 0008, R5; ADR-0025; ADR-0027) call the real model, so only
// `pnpm eval:intake`, `pnpm eval:rule-summary`, `pnpm eval:independent-check` and
// `pnpm eval:catalog-check` run them, by hand or from the manual intake-eval workflow; never part of
// `pnpm test`.
export default defineConfig({
  test: {
    include: ['test/eval/**/*.eval.ts'],
    // Under the workflow job's 45 minutes, which also cover its install and build.
    testTimeout: 35 * 60_000,
  },
});
