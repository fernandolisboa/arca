import { describe, expect, it } from 'vitest';
import { parseCalendarDate } from '../../src/calendar/calendar-date.js';
import {
  type DecisionState,
  type DecisionStates,
  type VersionIdentity,
  identityKey,
  newerProposedVersion,
  selectVersion,
  supersededVersions,
} from '../../src/rules/catalog.js';

function identity(number: number, effectiveFrom: string, corrects?: number): VersionIdentity {
  return {
    routeId: 'qm-sample',
    number,
    effectiveFrom: parseCalendarDate(effectiveFrom),
    ...(corrects === undefined ? {} : { corrects }),
    status: 'open',
    hash: `h${String(number)}`,
  };
}

function states(
  versions: readonly VersionIdentity[],
  overrides: Record<number, DecisionState> = {},
): DecisionStates {
  return new Map(
    versions.map((version) => [identityKey(version), overrides[version.number] ?? 'active']),
  );
}

function selected(
  versions: readonly VersionIdentity[],
  date: string,
  overrides: Record<number, DecisionState> = {},
): [number, DecisionState] | undefined {
  const selection = selectVersion(versions, parseCalendarDate(date), states(versions, overrides));
  return selection === undefined ? undefined : [selection.identity.number, selection.state];
}

describe('selectVersion', () => {
  const plain = [identity(1, '2020-01-01'), identity(2, '2024-01-01')];

  it.each<[string, string, [number, DecisionState] | undefined]>([
    ['before any version', '2019-12-31', undefined],
    ['on the first effective date', '2020-01-01', [1, 'active']],
    ['between versions', '2023-12-31', [1, 'active']],
    ['once the rule change applies', '2024-01-01', [2, 'active']],
  ])('picks the version in effect %s', (_label, date, expected) => {
    expect(selected(plain, date)).toEqual(expected);
  });

  it('reports a proposed version in effect instead of falling back', () => {
    expect(selected(plain, '2025-01-01', { 2: 'proposed' })).toEqual([2, 'proposed']);
  });

  it('treats a version with no decision as proposed', () => {
    const selection = selectVersion(
      plain,
      parseCalendarDate('2025-01-01'),
      new Map([[identityKey(identity(1, '2020-01-01')), 'active']]),
    );
    expect(selection?.state).toBe('proposed');
  });

  it('skips a rejected version, so the older one is back', () => {
    expect(selected(plain, '2025-01-01', { 2: 'rejected' })).toEqual([1, 'active']);
  });

  it.each<[string, VersionIdentity, string, number]>([
    ['on the same date, winning the tie', identity(2, '2020-01-01', 1), '2021-01-01', 2],
    [
      'dated earlier, when the original started too late',
      identity(2, '2019-06-01', 1),
      '2019-07-01',
      2,
    ],
    ['dated later, inside the original period', identity(2, '2022-01-01', 1), '2023-01-01', 2],
    ['dated later, before it applies', identity(2, '2022-01-01', 1), '2021-01-01', 1],
  ])('applies a correction %s', (_label, correction, date, expected) => {
    const versions = [identity(1, '2020-01-01'), correction];
    expect(selected(versions, date)?.[0]).toBe(expected);
  });

  it('drops a chain of corrections at once, even through a rejected link', () => {
    // Dated so that v1, the latest, would win if the chain stopped at the rejected v2.
    const chain = [
      identity(1, '2020-01-01'),
      identity(2, '2019-06-01', 1),
      identity(3, '2019-01-01', 2),
    ];
    expect(selected(chain, '2021-01-01')).toEqual([3, 'active']);
    expect(selected(chain, '2021-01-01', { 2: 'rejected' })).toEqual([3, 'active']);
    expect(selected(chain, '2021-01-01', { 3: 'rejected' })).toEqual([2, 'active']);
    expect(selected(chain, '2021-01-01', { 3: 'proposed' })).toEqual([3, 'proposed']);
  });

  it('never shows a closure pending as if the route were open', () => {
    const closed = [
      identity(1, '2020-01-01'),
      { ...identity(2, '2024-01-01'), status: 'closed' as const },
    ];
    expect(selected(closed, '2025-01-01', { 2: 'proposed' })).toEqual([2, 'proposed']);
  });

  it('refuses identities of two routes or two versions with one number', () => {
    const date = parseCalendarDate('2025-01-01');
    expect(() => selectVersion([...plain, identity(1, '2021-01-01')], date, new Map())).toThrow(
      RangeError,
    );
    expect(() =>
      selectVersion(
        [...plain, { ...identity(3, '2025-01-01'), routeId: 'qm-other' }],
        date,
        new Map(),
      ),
    ).toThrow(RangeError);
  });
});

describe('newerProposedVersion', () => {
  const first = identity(1, '2020-01-01');
  const versions = [first, identity(2, '2027-01-01'), identity(3, '2026-12-01', 1)];
  const at = parseCalendarDate('2026-11-03');

  it('names a later rule change that is not active, with the date it applies from', () => {
    const result = newerProposedVersion(
      versions,
      first,
      at,
      states(versions, { 2: 'proposed', 3: 'rejected' }),
    );
    expect(result).toEqual({ identity: versions[1], from: '2027-01-01' });
  });

  it('names a proposed correction of the selected version', () => {
    const result = newerProposedVersion(versions, first, at, states(versions, { 3: 'proposed' }));
    expect(result).toEqual({ identity: versions[2], from: '2026-12-01' });
  });

  it('is absent when every later version is active or rejected', () => {
    expect(newerProposedVersion(versions, first, at, states(versions))).toBeUndefined();
    expect(
      newerProposedVersion(versions, first, at, states(versions, { 2: 'rejected', 3: 'rejected' })),
    ).toBeUndefined();
  });
});

describe('supersededVersions', () => {
  // Two chains of corrections, shaped like a real route: 1 <- 3 <- 4 <- 6 from 2024, and a rule
  // change 2 <- 5 <- 7 <- 8 from 2026-11-30.
  const versions = [
    identity(1, '2024-04-01'),
    identity(2, '2026-11-30'),
    identity(3, '2024-04-01', 1),
    identity(4, '2025-11-12', 3),
    identity(5, '2026-11-30', 2),
    identity(6, '2025-11-12', 4),
    identity(7, '2026-11-30', 5),
    identity(8, '2026-11-30', 7),
  ];
  const superseded = (
    date: string,
    overrides: Record<number, DecisionState> = {},
    listed: readonly VersionIdentity[] = versions,
  ) =>
    [...supersededVersions(listed, parseCalendarDate(date), states(listed, overrides))].sort(
      (left, right) => left - right,
    );

  it('names every version that no date from today on would select', () => {
    expect(superseded('2026-11-11')).toEqual([1, 2, 3, 4, 5, 7]);
  });

  it('counts proposed versions as candidates, as selection does', () => {
    const proposed: Record<number, DecisionState> = Object.fromEntries(
      versions.map(({ number }) => [number, 'proposed' as const]),
    );
    expect(superseded('2026-11-11', proposed)).toEqual([1, 2, 3, 4, 5, 7]);
  });

  it('keeps a version in effect today and one that takes over on a later date', () => {
    expect(superseded('2026-11-11', { 8: 'rejected' })).toEqual([1, 2, 3, 4, 5, 8]);
  });

  it('keeps the version a rejected correction would have replaced', () => {
    expect(superseded('2026-11-11', { 6: 'rejected' })).toEqual([1, 2, 3, 5, 6, 7]);
  });

  it('keeps a version that takes effect today, and of two on one date the higher number', () => {
    const listed = [
      identity(1, '2020-01-01'),
      identity(2, '2026-11-11'),
      identity(3, '2026-11-11'),
    ];
    expect(superseded('2026-11-11', {}, listed)).toEqual([1, 2]);
  });

  it('names nothing for no versions', () => {
    expect(superseded('2026-11-11', {}, [])).toEqual([]);
  });

  it('names a version whose whole period ended before today', () => {
    const listed = [identity(1, '2020-01-01'), identity(2, '2024-01-01')];
    expect(superseded('2026-11-11', {}, listed)).toEqual([1]);
  });
});
