// The evaluation's call limit (spec 0008, R5): what bounds a run's cost.
import type { Extractor } from '../../../src/intake/extractor.js';

/**
 * The most model calls one evaluation run may make. Each call's output is capped, so this bounds
 * what a run can cost; a call is counted before it is sent, failed ones included.
 */
export const maxCallsPerRun = 60;

export class CallLimitReached extends Error {
  override name = 'CallLimitReached';
}

/** The extractor, refusing any call past the limit. */
export function withCallLimit(extractor: Extractor, limit = maxCallsPerRun) {
  let calls = 0;
  const limited: Extractor = {
    async draft(masked, known) {
      if (calls >= limit) throw new CallLimitReached(`The run reached its ${String(limit)} calls`);
      calls += 1;
      return extractor.draft(masked, known);
    },
  };
  return { extractor: limited, calls: () => calls };
}
