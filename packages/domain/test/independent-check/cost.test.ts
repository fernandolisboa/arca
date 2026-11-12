import { describe, expect, it } from 'vitest';
import {
  type CheckCost,
  type ModelUsage,
  type PriceTable,
  checkCost,
} from '../../src/independent-check/cost.js';
import { scriptedCheckerModel } from '../../src/independent-check/answers.js';

// Synthetic prices, in millionths of a dollar per million tokens.
const table: PriceTable = new Map([
  [
    'strong',
    { prices: { input: 2_000_000, cacheWrite: 4_000_000, cacheRead: 100_000, output: 10_000_000 } },
  ],
  [
    'fast',
    {
      prices: { input: 100_000, cacheWrite: 200_000, cacheRead: 10_000, output: 500_000 },
      longPrompt: {
        overTokens: 100_000,
        prices: { input: 500_000, cacheWrite: 1_000_000, cacheRead: 50_000, output: 2_500_000 },
      },
    },
  ],
]);

const call = (model: string, counts: Partial<Omit<ModelUsage, 'model'>> = {}): ModelUsage => ({
  model,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  ...counts,
});
const priced = (microUsd: number): CheckCost => ({ kind: 'priced', microUsd });

describe('checkCost', () => {
  it.each<[string, ModelUsage[], CheckCost | null]>([
    ['no call yet', [], null],
    ['a call with no tokens', [call('strong')], priced(0)],
    // 100k input at $2 + 10k output at $10 = $0.20 + $0.10.
    [
      'input and output',
      [call('strong', { inputTokens: 100_000, outputTokens: 10_000 })],
      priced(300_000),
    ],
    [
      // 20k written at $4 ($0.08), 30k read at $0.10 ($0.003), 50k uncached at $2 ($0.10).
      'cache writes and reads, counted inside the input',
      [
        call('strong', {
          inputTokens: 100_000,
          cacheWriteTokens: 20_000,
          cacheReadTokens: 30_000,
        }),
      ],
      priced(183_000),
    ],
    [
      'a prompt at the threshold keeps the base prices',
      [call('fast', { inputTokens: 100_000, outputTokens: 1_000 })],
      priced(10_500),
    ],
    [
      // Every count of a long prompt pays the dearer prices, cache reads included.
      'a prompt over the threshold pays the long-prompt prices',
      [call('fast', { inputTokens: 100_001, cacheReadTokens: 1, outputTokens: 1_000 })],
      priced(52_500),
    ],
    [
      'several calls add up',
      [
        call('fast', { inputTokens: 10_000, outputTokens: 1_000 }),
        call('fast', { inputTokens: 10_000, outputTokens: 1_000 }),
        call('strong', { inputTokens: 100_000, outputTokens: 10_000 }),
      ],
      priced(303_000),
    ],
    ['a fraction of a millionth rounds', [call('fast', { inputTokens: 5 })], priced(1)],
    ['less than half a millionth rounds down', [call('fast', { inputTokens: 4 })], priced(0)],
    ['a model with no price', [call('strong'), call('unpriced')], { kind: 'unknown' }],
    ['input not reported', [call('strong', { inputTokens: null })], { kind: 'unknown' }],
    ['output not reported', [call('strong', { outputTokens: null })], { kind: 'unknown' }],
    [
      'cache counts larger than the prompt',
      [call('strong', { inputTokens: 10, cacheReadTokens: 11 })],
      { kind: 'unknown' },
    ],
    ['the scripted checker', [call(scriptedCheckerModel)], { kind: 'scripted' }],
  ])('prices %s', (_, usages, expected) => {
    expect(checkCost(usages, table)).toEqual(expected);
  });
});
