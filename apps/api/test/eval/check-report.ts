// What the independent check's two evaluations share in their reports (ADR-0027): model text made
// inert for the public job summary, and what a run's calls cost.
import type { LogEntry, Logger } from '@arca/telemetry';
import { checkCost } from '@arca/domain';
import { checkModelPrices } from '../../src/knowledge/check/prices.js';
import { type CacheUse, cacheUseLine, countCacheUse, noCacheUse } from './cache-use.js';

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

export interface Usage extends CacheUse {
  calls: number;
  outputTokens: number;
  dollars: number;
  /** Cache use per model, since the check and the passage locator cache different instructions. */
  cacheByModel: Map<string, CacheUse>;
}

export const noUsage = (): Usage => ({
  ...noCacheUse(),
  calls: 0,
  outputTokens: 0,
  dollars: 0,
  cacheByModel: new Map(),
});

/** One report line of cache use for each model the run called. */
export const cacheUseLines = ({ cacheByModel }: Usage) =>
  [...cacheByModel].map(([model, use]) => `\`${model}\`: ${cacheUseLine(use)}`);

/** A logger that keeps the call metadata the check logs, never more. */
export function usageLogger(usage: Usage): Logger {
  const record = (entry: LogEntry) => {
    const { model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = entry;
    if (model === undefined) return;
    const output = Number(outputTokens ?? 0);
    // The app's own price table and pricing; a call it cannot price counts as nothing.
    const cost = checkCost(
      [
        {
          model: String(model),
          inputTokens: Number(inputTokens ?? 0),
          outputTokens: output,
          cacheReadTokens: Number(cacheReadTokens ?? 0),
          cacheWriteTokens: Number(cacheWriteTokens ?? 0),
        },
      ],
      checkModelPrices,
    );
    usage.calls += 1;
    usage.outputTokens += output;
    usage.dollars += cost?.kind === 'priced' ? cost.microUsd / 1_000_000 : 0;
    countCacheUse(usage, entry);
    const ofModel = usage.cacheByModel.get(String(model)) ?? noCacheUse();
    countCacheUse(ofModel, entry);
    usage.cacheByModel.set(String(model), ofModel);
  };
  return { info: record, error: () => undefined };
}

/** The items the model left unchecked with no note, which the prompt asks it never to do. */
export const withoutReason = <Item extends { reason: string | null; note: string | null }>(
  items: readonly Item[],
) => items.filter(({ reason, note }) => reason === 'model_could_not_check' && note === null);
