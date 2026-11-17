import { aiStageOptions } from '@arca/api-contract/routes';
import type { PriceTable } from '@arca/domain';

/**
 * What each model an update request calls costs (ADR-0031), in millionths of a U.S. dollar per
 * million tokens, read on 2026-11-17 from https://platform.claude.com/docs/en/about-claude/pricing
 * and https://docs.typesafe.ai/models.md (read 2026-11-16). The cache write price is the 5-minute one, the lifetime research
 * asks for; Jev charges input tokens only. A model settings offer with no row here shows its cost
 * as unknown.
 */
export const updateModelPrices: PriceTable = new Map([
  [
    aiStageOptions.research.defaultModel,
    {
      prices: { input: 4_000_000, cacheWrite: 5_000_000, cacheRead: 200_000, output: 20_000_000 },
    },
  ],
  [
    aiStageOptions.validation.defaultModel,
    { prices: { input: 42_000, cacheWrite: 0, cacheRead: 0, output: 0 } },
  ],
]);

/** One web search, US$ 10 per thousand, in millionths of a dollar. */
export const webSearchMicroUsd = 10_000;
