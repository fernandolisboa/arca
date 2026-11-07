// The rule summary evaluation's call limit (ADR-0025): what bounds a run's cost.
import type { Summarizer } from '../../../src/knowledge/summary/summarizer.js';
import { callCounter } from '../call-limit.js';

/**
 * The most model calls one run may make: each case and its one retry, with room for a catalog of
 * 37 versions beside the three planted cases. Each call's output is capped, so this bounds what a
 * run can cost.
 */
export const maxCallsPerRun = 80;

/** The summarizer, refusing any call past the limit; a call counts before it is sent. */
export function withCallLimit(summarizer: Summarizer, limit = maxCallsPerRun) {
  const counter = callCounter(limit);
  const limited: Summarizer = {
    async summarize(content) {
      counter.take();
      return summarizer.summarize(content);
    },
  };
  return { summarizer: limited, calls: counter.calls };
}
