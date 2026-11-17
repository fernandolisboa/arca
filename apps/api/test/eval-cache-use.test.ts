import { describe, expect, it } from 'vitest';
import type { Extractor } from '../src/intake/extractor.js';
import { cacheHitRate, cacheUseLine, noCacheUse } from './eval/cache-use.js';
import { withCallLimit } from './eval/intake/call-limit.js';

// What the evaluation reports say about the prompt cache, and what a run's calls cost with it.
describe("an evaluation run's cache use", () => {
  it('is the share of input tokens read from the cache, and nothing of an empty run', () => {
    expect(cacheHitRate(noCacheUse())).toBe(0);
    const use = { inputTokens: 4_000, cacheReadTokens: 1_000, cacheWriteTokens: 500 };
    expect(cacheHitRate(use)).toBe(0.25);
    expect(cacheUseLine(use)).toBe(
      'Prompt cache: 1000 of 4000 input tokens read from the cache (25.0%), 500 written to it.',
    );
  });

  it('adds up what the answered calls of a limited run read and wrote', async () => {
    const reply = { reply: {}, model: 'model', promptVersion: 'prompt' };
    const counts = { inputTokens: 1_000, cacheReadTokens: 900, cacheWriteTokens: 0 };
    const replies = [{ ...reply, ...counts, cacheReadTokens: 0, cacheWriteTokens: 900 }, reply];
    const fake: Extractor = {
      draft: () => Promise.resolve(replies.shift() ?? { ...reply, ...counts }),
    };
    const { extractor, cache } = withCallLimit(fake, 3);
    await extractor.draft('a', []);
    await extractor.draft('b', []);
    await extractor.draft('c', []);
    expect(cache).toEqual({ inputTokens: 2_000, cacheReadTokens: 900, cacheWriteTokens: 900 });
  });
});
