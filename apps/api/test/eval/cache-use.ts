// How much of a run's input the vendor's prompt cache served: the only proof the cached prefix
// works, since a prefix that stopped matching fails silently and only costs more.

export interface CacheUse {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const noCacheUse = (): CacheUse => ({
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

type Counts = { readonly [Count in keyof CacheUse]?: unknown };

/** Adds one call's counts, as a model reply or a log entry carries them. */
export function countCacheUse(use: CacheUse, counts: Counts): void {
  use.inputTokens += Number(counts.inputTokens ?? 0);
  use.cacheReadTokens += Number(counts.cacheReadTokens ?? 0);
  use.cacheWriteTokens += Number(counts.cacheWriteTokens ?? 0);
}

/** The share of input tokens read from the cache, from 0 to 1. */
export const cacheHitRate = ({ inputTokens, cacheReadTokens }: CacheUse) =>
  inputTokens === 0 ? 0 : cacheReadTokens / inputTokens;

/** The run's cache use as one report line. */
export const cacheUseLine = (use: CacheUse) =>
  `Prompt cache: ${String(use.cacheReadTokens)} of ${String(use.inputTokens)} input tokens read from the cache (${(cacheHitRate(use) * 100).toFixed(1)}%), ${String(use.cacheWriteTokens)} written to it.`;
