import { describe, expect, it } from 'vitest';
import { parseCalendarDate } from '../../src/calendar/calendar-date.js';
import { type DecisionState, type VersionIdentity, identityKey } from '../../src/rules/catalog.js';
import {
  type CorrectionAnswer,
  type CorrectionAnswerRefusal,
  type CorrectionEvent,
  type CorrectionState,
  correctionAnswerRefusal,
  correctionState,
} from '../../src/rules/correction-request.js';

function identity(number: number, corrects?: number): VersionIdentity {
  return {
    routeId: 'qm-sample',
    number,
    effectiveFrom: parseCalendarDate('2026-01-01'),
    ...(corrects === undefined ? {} : { corrects }),
    status: 'open',
    hash: `h${String(number)}`,
  };
}

/** v1; v2 corrects v1; v3 corrects v2; v4 follows with no correction. */
const route = [identity(1), identity(2, 1), identity(3, 2), identity(4)];

const taken: CorrectionEvent = { kind: 'taken' };
const closed: CorrectionEvent = { kind: 'closed' };
const answered = (proposedVersion: number | null): CorrectionEvent => ({
  kind: 'answered',
  proposedVersion,
});

describe('correctionState', () => {
  it.each<
    [
      string,
      number | null,
      readonly CorrectionEvent[],
      Record<number, DecisionState>,
      CorrectionState,
    ]
  >([
    ['a new request', 1, [], {}, 'open'],
    ['a taken request', 1, [taken], {}, 'taken'],
    ['an answer with a proposed version still proposed', 1, [taken, answered(2)], {}, 'answered'],
    ['an answer that nothing changed', 1, [taken, answered(null)], {}, 'answered'],
    ['an admin close', 1, [closed], {}, 'closed'],
    ['an admin close of a taken request', 1, [taken, closed], {}, 'closed'],
    ['the proposed version activated', 1, [taken, answered(4)], { 4: 'active' }, 'closed'],
    ['the proposed version rejected', 1, [taken, answered(4)], { 4: 'rejected' }, 'closed'],
    ['an answer naming a version the catalog lacks', 1, [answered(9)], { 4: 'active' }, 'answered'],
    ['a direct correction activated', 1, [], { 2: 'active' }, 'closed'],
    ['a correction of a correction activated', 1, [], { 3: 'active' }, 'closed'],
    ['a correction rejected', 1, [], { 2: 'rejected' }, 'open'],
    ['a later version that corrects nothing activated', 1, [], { 4: 'active' }, 'open'],
    ['the request version itself activated', 2, [], { 2: 'active' }, 'open'],
    ['a correction of an older version activated', 2, [], { 2: 'active', 1: 'active' }, 'open'],
    ['a new-route request', null, [], {}, 'open'],
    ['a new-route request taken', null, [taken], {}, 'taken'],
    ['a new-route request with a version proposed', null, [taken, answered(1)], {}, 'answered'],
    ['a new-route request whose version is active', null, [answered(1)], { 1: 'active' }, 'closed'],
    ['a new-route request with any version active', null, [taken], { 2: 'active' }, 'taken'],
    ['a new-route request closed by an admin', null, [closed], {}, 'closed'],
  ])('is right for %s', (_label, versionNumber, events, decided, expected) => {
    const states = new Map(
      Object.entries(decided).map(([number, state]) => {
        const found = route.find((version) => version.number === Number(number));
        if (found === undefined) throw new Error('unknown version');
        return [identityKey(found), state] as const;
      }),
    );
    expect(correctionState({ versionNumber, events, identities: route, states })).toBe(expected);
  });

  it('stops on a correction cycle', () => {
    const cyclic = [identity(1, 2), identity(2, 1)];
    expect(
      correctionState({ versionNumber: 3, events: [], identities: cyclic, states: new Map() }),
    ).toBe('open');
  });
});

describe('correctionAnswerRefusal', () => {
  const proposing = (number: number): CorrectionAnswer => ({ kind: 'version_proposed', number });
  const noChange: CorrectionAnswer = { kind: 'no_change', explanation: 'Nada mudou.' };
  const take: CorrectionAnswer = { kind: 'taken' };

  it.each<
    [string, number | null, CorrectionState, CorrectionAnswer, CorrectionAnswerRefusal | undefined]
  >([
    ['taking an open request', 1, 'open', take, undefined],
    ['taking a taken request', 1, 'taken', take, 'wrong_state'],
    ['taking an answered request', 1, 'answered', take, 'wrong_state'],
    ['taking a closed request', 1, 'closed', take, 'wrong_state'],
    ['no change on a taken request', 1, 'taken', noChange, undefined],
    ['no change on an open request', 1, 'open', noChange, 'wrong_state'],
    ['no change on an answered request', 1, 'answered', noChange, 'wrong_state'],
    ['a direct correction', 1, 'taken', proposing(2), undefined],
    ['a correction of a correction', 1, 'taken', proposing(3), undefined],
    ['a later version', 1, 'taken', proposing(4), undefined],
    ['a later version that corrects another', 2, 'taken', proposing(3), undefined],
    ['a version on an open request', 1, 'open', proposing(2), 'wrong_state'],
    ['a version on a closed request', 1, 'closed', proposing(2), 'wrong_state'],
    ['a version the route does not serve', 1, 'taken', proposing(9), 'unknown_version'],
    ['the request version itself', 2, 'taken', proposing(2), 'unrelated_version'],
    ['an older version', 3, 'taken', proposing(1), 'unrelated_version'],
    ['an older version that corrects another', 4, 'taken', proposing(2), 'unrelated_version'],
    ['a new route: any proposed version', null, 'taken', proposing(1), undefined],
    ['a new route: a version it does not serve', null, 'taken', proposing(9), 'unknown_version'],
    ['a new route: on an open request', null, 'open', proposing(1), 'wrong_state'],
  ])('is right for %s', (_label, versionNumber, state, answer, expected) => {
    expect(
      correctionAnswerRefusal({
        versionNumber,
        state,
        answer,
        identities: route,
        states: new Map(),
      }),
    ).toBe(expected);
  });

  it.each<[string, DecisionState]>([
    ['already active', 'active'],
    ['already rejected', 'rejected'],
  ])('refuses a later version %s, since it would close the request', (_label, decided) => {
    const later = route.find((version) => version.number === 4);
    if (later === undefined) throw new Error('missing version');
    expect(
      correctionAnswerRefusal({
        versionNumber: 1,
        state: 'taken',
        answer: proposing(4),
        identities: route,
        states: new Map([[identityKey(later), decided]]),
      }),
    ).toBe('decided_version');
  });

  it('accepts an older version that corrects the request version through a cycle', () => {
    const cyclic = [identity(1, 2), identity(2, 1)];
    expect(
      correctionAnswerRefusal({
        versionNumber: 2,
        state: 'taken',
        answer: proposing(1),
        identities: cyclic,
        states: new Map(),
      }),
    ).toBeUndefined();
  });
});
