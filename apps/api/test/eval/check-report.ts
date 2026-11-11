// What the independent check's two evaluations share in their reports (ADR-0027): model text made
// inert for the public job summary, and what a run's calls cost.
import type { LogEntry, Logger } from '@arca/telemetry';
import { passageLocateModel, ruleCheckModel } from '../../src/knowledge/check/model.js';
import { type CacheUse, countCacheUse, noCacheUse } from './cache-use.js';

/**
 * Model text as inert text in the public job summary: one line, no Markdown, no markup, no
 * mention and no formula.
 */
export const plain = (text: string | null) =>
  (text ?? '')
    .replace(/[\n\r]/gu, ' ')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/[\\`*_[\]()!#~|@$]/gu, '\\$&');

interface Price {
  readonly input: number;
  readonly output: number;
  /** What a token read from the prompt cache costs, as a share of the input price. */
  readonly cacheRead: number;
}

/** What a token written to the one-hour prompt cache costs, as a multiple of the input price. */
const cacheWrite = 2;

/** The prompt size past which the passage locator's model is priced at its higher rate. */
const longPromptTokens = 100_000;

/**
 * List prices in US dollars per million tokens of the check's model, Claude Sonnet 5.5, and of the
 * passage locator's, Claude Haiku 5.5, whose rate rises for a prompt over 100,000 tokens; read
 * 2026-11-09 from https://platform.claude.com/docs/en/about-claude/pricing, and the cache rates
 * 2026-11-11 from https://platform.claude.com/docs/en/build-with-claude/prompt-caching.
 */
function priceOf(model: string, inputTokens: number): Price {
  if (model === ruleCheckModel) return { input: 2, output: 10, cacheRead: 0.05 };
  if (model !== passageLocateModel) return { input: 0, output: 0, cacheRead: 0 };
  return inputTokens > longPromptTokens
    ? { input: 0.5, output: 2.5, cacheRead: 0.1 }
    : { input: 0.1, output: 0.5, cacheRead: 0.1 };
}

export interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  dollars: number;
  cache: CacheUse;
}

export const noUsage = (): Usage => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  dollars: 0,
  cache: noCacheUse(),
});

/** A logger that keeps the call metadata the check logs, never more. */
export function usageLogger(usage: Usage): Logger {
  const record = (entry: LogEntry) => {
    const { model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = entry;
    if (model === undefined) return;
    const input = Number(inputTokens ?? 0);
    const output = Number(outputTokens ?? 0);
    const read = Number(cacheReadTokens ?? 0);
    const written = Number(cacheWriteTokens ?? 0);
    const price = priceOf(String(model), input);
    // `inputTokens` counts every input token, so the cached ones are repriced, not added.
    const pricedInput = input - read - written + read * price.cacheRead + written * cacheWrite;
    usage.calls += 1;
    usage.inputTokens += input;
    usage.outputTokens += output;
    usage.dollars += (pricedInput * price.input + output * price.output) / 1_000_000;
    countCacheUse(usage.cache, entry);
  };
  return { info: record, error: () => undefined };
}

/** The items the model left unchecked with no note, which the prompt asks it never to do. */
export const withoutReason = <Item extends { reason: string | null; note: string | null }>(
  items: readonly Item[],
) => items.filter(({ reason, note }) => reason === 'model_could_not_check' && note === null);
