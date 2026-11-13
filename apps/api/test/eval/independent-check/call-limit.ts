// The independent check evaluation's call limit (ADR-0027): what bounds a run's cost.
import type { RuleChecker } from '../../../src/knowledge/check/checker.js';
import type { PassageLocator } from '../../../src/knowledge/check/locator.js';
import { callCounter } from '../call-limit.js';

/**
 * The most model calls one run may make: each case and its one retry (no case has the items or
 * pages that take several checker calls; the version check's tests cover those), one pick of
 * passages for each case with a long act, the second looks (with their picks and retries) at the
 * items a long act's case left unconfirmed, and a little room. Each call's output is
 * capped and its input holds only synthetic pages, the long ones as an outline or an excerpt, so
 * this bounds what a run can cost.
 */
export const maxCallsPerRun = 150;

/**
 * The checker and the locator, refusing any call past the limit they share; a call counts before
 * it is sent.
 */
export function withCallLimit(
  checker: RuleChecker,
  locator: PassageLocator,
  limit = maxCallsPerRun,
) {
  const counter = callCounter(limit);
  const limited: RuleChecker = {
    async check(request, onEntry) {
      counter.take();
      return checker.check(request, onEntry);
    },
  };
  const limitedLocator: PassageLocator = {
    async locate(request) {
      counter.take();
      return locator.locate(request);
    },
  };
  return { checker: limited, locator: limitedLocator, calls: counter.calls };
}
