// The independent check evaluation's call limit (ADR-0027): what bounds a run's cost.
import type { RuleChecker } from '../../../src/knowledge/check/checker.js';
import { callCounter } from '../call-limit.js';

/**
 * The most model calls one run may make: each of the 18 cases and its one retry, with a little
 * room. Each call's output is capped and its input holds only short synthetic pages, so this
 * bounds what a run can cost.
 */
export const maxCallsPerRun = 40;

/** The checker, refusing any call past the limit; a call counts before it is sent. */
export function withCallLimit(checker: RuleChecker, limit = maxCallsPerRun) {
  const counter = callCounter(limit);
  const limited: RuleChecker = {
    async check(request) {
      counter.take();
      return checker.check(request);
    },
  };
  return { checker: limited, calls: counter.calls };
}
