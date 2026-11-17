import { scriptedCheckerModel } from './answers.js';

/**
 * A model's prices for one prompt length, in millionths of a U.S. dollar per million tokens, so
 * that every sum stays a whole number. `cacheWrite` is the price of the cache lifetime Arca's
 * calls ask for.
 */
export interface TokenPrices {
  readonly input: number;
  readonly cacheWrite: number;
  readonly cacheRead: number;
  readonly output: number;
}

/** A model's prices, and the dearer ones a call pays when its prompt is longer than a threshold. */
export interface ModelPricing {
  readonly prices: TokenPrices;
  readonly longPrompt?: { readonly overTokens: number; readonly prices: TokenPrices };
}

export type PriceTable = ReadonlyMap<string, ModelPricing>;

/**
 * What one model call used, as the provider reported it. `inputTokens` counts the whole prompt:
 * the tokens read from the cache and written to it are part of it. Null where the provider said
 * nothing; cache counts it did not report are taken as no caching.
 */
export interface ModelUsage {
  readonly model: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
}

/**
 * What a check's model calls cost: priced in millionths of a dollar; `unknown` when a model has
 * no price or a call's counts are missing or do not add up, never a guess; `scripted` when the
 * scripted checker ran, which costs nothing and is a test, not a price.
 */
export type CheckCost =
  | { readonly kind: 'priced'; readonly microUsd: number }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'scripted' };

const perMillion = 1_000_000n;

/** The most a check's cost is shown as, US$ 1,000; anything above is no real check's and is unknown. */
export const maxCheckCostMicroUsd = 1_000_000_000;

/** A call's cost in millionths of a millionth of a dollar, or undefined when it cannot be priced. */
function callCost(usage: ModelUsage, table: PriceTable): bigint | undefined {
  const pricing = table.get(usage.model);
  const { inputTokens, outputTokens } = usage;
  if (pricing === undefined || inputTokens === null || outputTokens === null) return undefined;
  const read = usage.cacheReadTokens ?? 0;
  const written = usage.cacheWriteTokens ?? 0;
  const uncached = inputTokens - read - written;
  if (uncached < 0) return undefined;
  const { longPrompt } = pricing;
  const prices =
    longPrompt !== undefined && inputTokens > longPrompt.overTokens
      ? longPrompt.prices
      : pricing.prices;
  return (
    BigInt(uncached) * BigInt(prices.input) +
    BigInt(written) * BigInt(prices.cacheWrite) +
    BigInt(read) * BigInt(prices.cacheRead) +
    BigInt(outputTokens) * BigInt(prices.output)
  );
}

/**
 * What a check's calls cost together, computed in code from the reviewed price table (ADR-0027,
 * "On demand, with progress"); null before the first call.
 */
export function checkCost(usages: readonly ModelUsage[], table: PriceTable): CheckCost | null {
  if (usages.length === 0) return null;
  if (usages.some(({ model }) => model === scriptedCheckerModel)) return { kind: 'scripted' };
  let total = 0n;
  for (const usage of usages) {
    const cost = callCost(usage, table);
    if (cost === undefined) return { kind: 'unknown' };
    total += cost;
  }
  // Half a millionth of a dollar and up rounds up.
  const microUsd = (total + perMillion / 2n) / perMillion;
  return microUsd > BigInt(maxCheckCostMicroUsd)
    ? { kind: 'unknown' }
    : { kind: 'priced', microUsd: Number(microUsd) };
}
