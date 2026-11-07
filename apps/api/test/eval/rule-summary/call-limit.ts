// The rule summary evaluation's call limit (ADR-0025): what bounds a run's cost.
import type { Summarizer } from '../../../src/knowledge/summary/summarizer.js';

/**
 * The most model calls one run may make: each case and its one retry, with room for a catalog of
 * 37 versions beside the three planted cases. Each call's output is capped, so this bounds what a
 * run can cost.
 */
export const maxCallsPerRun = 80;

export class CallLimitReached extends Error {
  override name = 'CallLimitReached';
}

/** The summarizer, refusing any call past the limit; a call counts before it is sent. */
export function withCallLimit(summarizer: Summarizer, limit = maxCallsPerRun) {
  let calls = 0;
  const limited: Summarizer = {
    async summarize(content) {
      if (calls >= limit) throw new CallLimitReached(`The run reached its ${String(limit)} calls`);
      calls += 1;
      return summarizer.summarize(content);
    },
  };
  return { summarizer: limited, calls: () => calls };
}
