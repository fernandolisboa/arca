import { describe, expect, it } from 'vitest';
import {
  type MemberRequestFacts,
  declinable,
  memberRequestState,
  releasable,
} from '../../src/rule-update/member-request.js';

describe("a member's update request (ADR-0031, #462)", () => {
  it.each<[MemberRequestFacts, string, boolean, boolean]>([
    [{ declined: false, run: null }, 'received', true, true],
    [{ declined: false, run: 'running' }, 'released', false, false],
    [{ declined: false, run: 'failed' }, 'released', false, true],
    [{ declined: false, run: 'stalled' }, 'released', false, true],
    [{ declined: false, run: 'finished' }, 'finished', false, false],
    [{ declined: true, run: null }, 'declined', false, false],
    [{ declined: true, run: 'failed' }, 'declined', false, false],
  ])('%o is %s, releasable %s, declinable %s', (facts, state, canRelease, canDecline) => {
    expect(memberRequestState(facts)).toBe(state);
    expect(releasable(facts)).toBe(canRelease);
    expect(declinable(facts)).toBe(canDecline);
  });
});
