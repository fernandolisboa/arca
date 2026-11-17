import { describe, expect, it } from 'vitest';
import {
  type MemberRequestFacts,
  declinable,
  memberRequestPending,
  memberRequestState,
  releasable,
} from '../../src/rule-update/member-request.js';

describe("a member's update request (ADR-0031, #462)", () => {
  it.each<[MemberRequestFacts, string, boolean, boolean, boolean]>([
    [{ declined: false, run: null }, 'received', true, true, true],
    [{ declined: false, run: 'running' }, 'released', false, false, true],
    [{ declined: false, run: 'failed' }, 'released', false, true, false],
    [{ declined: false, run: 'stalled' }, 'released', false, true, false],
    [{ declined: false, run: 'finished' }, 'finished', false, false, false],
    [{ declined: true, run: null }, 'declined', false, false, false],
    [{ declined: true, run: 'failed' }, 'declined', false, false, false],
  ])(
    '%o is %s, releasable %s, declinable %s, pending %s',
    (facts, state, canRelease, canDecline, waits) => {
      expect(memberRequestState(facts)).toBe(state);
      expect(releasable(facts)).toBe(canRelease);
      expect(declinable(facts)).toBe(canDecline);
      expect(memberRequestPending(facts)).toBe(waits);
    },
  );
});
