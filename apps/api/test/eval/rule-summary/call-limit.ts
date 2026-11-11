// The rule summary evaluation's call limit (ADR-0025): what bounds a run's cost.
import type { Summarizer } from '../../../src/knowledge/summary/summarizer.js';
import { countCacheUse, noCacheUse } from '../cache-use.js';
import { callCounter } from '../call-limit.js';

/**
 * The most model calls one run may make: each case and its one retry, for at most 37 routes beside
 * the three planted cases. Each call's output is capped, so this bounds what a run can cost.
 */
export const maxCallsPerRun = 80;

/**
 * The summarizer, refusing any call past the limit; a call counts before it is sent. `cache` adds
 * up what the answered calls read from and wrote to the prompt cache.
 */
export function withCallLimit(summarizer: Summarizer, limit = maxCallsPerRun) {
  const counter = callCounter(limit);
  const cache = noCacheUse();
  const limited: Summarizer = {
    async summarize(content) {
      counter.take();
      const reply = await summarizer.summarize(content);
      countCacheUse(cache, reply);
      return reply;
    },
  };
  return { summarizer: limited, calls: counter.calls, cache };
}
