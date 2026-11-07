// The evaluation's call limit (spec 0008, R5): what bounds a run's cost.
import type { Extractor } from '../../../src/intake/extractor.js';
import { CallLimitReached, callCounter } from '../call-limit.js';

export { CallLimitReached };

/**
 * The most model calls one evaluation run may make. Each call's output is capped, so this bounds
 * what a run can cost; a call is counted before it is sent, failed ones included.
 */
export const maxCallsPerRun = 60;

/** The extractor, refusing any call past the limit; a call counts before it is sent. */
export function withCallLimit(extractor: Extractor, limit = maxCallsPerRun) {
  const counter = callCounter(limit);
  const limited: Extractor = {
    async draft(masked, known, writer) {
      counter.take();
      return extractor.draft(masked, known, writer);
    },
  };
  return { extractor: limited, calls: counter.calls };
}
