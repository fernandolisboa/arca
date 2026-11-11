// The evaluation's call limit (spec 0008, R5): what bounds a run's cost.
import type { Extractor } from '../../../src/intake/extractor.js';
import { countCacheUse, noCacheUse } from '../cache-use.js';
import { callCounter } from '../call-limit.js';

/**
 * The most model calls one evaluation run may make. Each call's output is capped, so this bounds
 * what a run can cost; a call is counted before it is sent, failed ones included.
 */
export const maxCallsPerRun = 60;

/**
 * The extractor, refusing any call past the limit; a call counts before it is sent. `cache` adds
 * up what the answered calls read from and wrote to the prompt cache.
 */
export function withCallLimit(extractor: Extractor, limit = maxCallsPerRun) {
  const counter = callCounter(limit);
  const cache = noCacheUse();
  const limited: Extractor = {
    async draft(masked, known, writer) {
      counter.take();
      const reply = await extractor.draft(masked, known, writer);
      countCacheUse(cache, reply);
      return reply;
    },
  };
  return { extractor: limited, calls: counter.calls, cache };
}
