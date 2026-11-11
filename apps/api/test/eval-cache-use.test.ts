import { describe, expect, it } from 'vitest';
import { passageLocateModel, ruleCheckModel } from '../src/knowledge/check/model.js';
import type { Extractor } from '../src/intake/extractor.js';
import { cacheHitRate, cacheUseLine, noCacheUse } from './eval/cache-use.js';
import { cacheUseLines, noUsage, usageLogger } from './eval/check-report.js';
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

describe("what a check evaluation's calls cost", () => {
  const dollarsOf = (entry: Parameters<ReturnType<typeof usageLogger>['info']>[0]) => {
    const usage = noUsage();
    usageLogger(usage).info(entry);
    return usage.dollars;
  };
  const million = 1_000_000;

  it.each([
    ['no cache use', { model: ruleCheckModel, inputTokens: million, outputTokens: 0 }, 2],
    [
      'tokens read from the cache, at a twentieth of the input price',
      { model: ruleCheckModel, inputTokens: million, cacheReadTokens: million, outputTokens: 0 },
      0.1,
    ],
    [
      'tokens written to the one-hour cache, at twice the input price',
      { model: ruleCheckModel, inputTokens: million, cacheWriteTokens: million, outputTokens: 0 },
      4,
    ],
    [
      'the passage locator reading from the cache, at a tenth of its input price',
      { model: passageLocateModel, inputTokens: 50_000, cacheReadTokens: 50_000, outputTokens: 0 },
      0.0005,
    ],
    [
      "the passage locator's long prompt, at its higher rate",
      { model: passageLocateModel, inputTokens: 200_000, outputTokens: million },
      2.6,
    ],
  ] as const)('prices %s', (_, entry, dollars) => {
    expect(dollarsOf(entry)).toBeCloseTo(dollars, 10);
  });

  it('keeps the cache use of each model apart and ignores a line that is not a model call', () => {
    const usage = noUsage();
    const logger = usageLogger(usage);
    logger.info({ model: ruleCheckModel, inputTokens: 3_000, cacheReadTokens: 1_500 });
    logger.info({ model: passageLocateModel, inputTokens: 1_000, cacheWriteTokens: 600 });
    logger.info({ errorCode: 'check_fetch_timeout' });
    expect(usage).toMatchObject({ calls: 2, inputTokens: 4_000, cacheReadTokens: 1_500 });
    expect(cacheUseLines(usage)).toEqual([
      `\`${ruleCheckModel}\`: Prompt cache: 1500 of 3000 input tokens read from the cache (50.0%), 0 written to it.`,
      `\`${passageLocateModel}\`: Prompt cache: 0 of 1000 input tokens read from the cache (0.0%), 600 written to it.`,
    ]);
  });
});
