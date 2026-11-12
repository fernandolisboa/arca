import type { PriceTable } from '@arca/domain';
import { passageLocateModel, ruleCheckModel } from './model.js';

/**
 * What each model a check calls costs (ADR-0027, "On demand, with progress"), in millionths of a
 * U.S. dollar per million tokens, read on 2026-11-11 from
 * https://platform.claude.com/docs/en/about-claude/pricing. Reviewed code like the model names:
 * a model change adds its row here, and a model with no row shows its cost as unknown. The
 * cache write price is the 1-hour one, the lifetime every Arca call asks for (`ai/claude.ts`).
 */
export const checkModelPrices: PriceTable = new Map([
  [
    ruleCheckModel,
    {
      prices: { input: 2_000_000, cacheWrite: 4_000_000, cacheRead: 100_000, output: 10_000_000 },
    },
  ],
  [
    passageLocateModel,
    {
      prices: { input: 100_000, cacheWrite: 200_000, cacheRead: 10_000, output: 500_000 },
      // A call whose prompt, cache reads and writes included, is over 100,000 tokens pays more
      // for every token of it.
      longPrompt: {
        overTokens: 100_000,
        prices: { input: 500_000, cacheWrite: 1_000_000, cacheRead: 50_000, output: 2_500_000 },
      },
    },
  ],
]);
