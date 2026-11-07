import { describe, expect, it } from 'vitest';
import { adminHistory, type AdminGrantRow } from '../src/knowledge/admins.js';

// The admin role's history replayed (ADR-0027). Synthetic account IDs only.
const owner = '00000000-0000-4000-8000-0000000000a1';
const ana = '00000000-0000-4000-8000-0000000000b1';
const bruno = '00000000-0000-4000-8000-0000000000b2';
const carla = '00000000-0000-4000-8000-0000000000b3';

const grant = (
  id: string,
  grantee: string,
  at: bigint,
  actor = owner,
  actorGrantId: string | null = null,
): AdminGrantRow => ({
  id,
  kind: 'grant',
  granteeAccountId: grantee,
  actorAccountId: actor,
  actorBasis: actorGrantId === null ? 'owner_list' : 'grant',
  actorGrantId,
  removesGrantId: null,
  at,
});

const removal = (
  id: string,
  grantee: string,
  removes: string,
  at: bigint,
  actor = owner,
  actorGrantId: string | null = null,
): AdminGrantRow => ({
  ...grant(id, grantee, at, actor, actorGrantId),
  kind: 'removal',
  removesGrantId: removes,
});

describe('adminHistory', () => {
  it('has no grant in force without rows', () => {
    const history = adminHistory([]);
    expect(history.liveGrant(ana)).toBeUndefined();
    expect(history.inForce('g1', ana, 10n)).toBe(false);
  });

  it.each<[string, readonly AdminGrantRow[], string | undefined]>([
    ['an owner-list grant', [grant('g1', ana, 10n)], 'g1'],
    ['a removal ends it', [grant('g1', ana, 10n), removal('r1', ana, 'g1', 20n)], undefined],
    [
      'a grant after a removal starts a new one',
      [grant('g1', ana, 10n), removal('r1', ana, 'g1', 20n), grant('g2', ana, 30n)],
      'g2',
    ],
    [
      'a second grant while one is in force changes nothing',
      [grant('g1', ana, 10n), grant('g2', ana, 20n)],
      'g1',
    ],
    [
      'a grant by an account that was never an admin counts for nothing',
      [grant('g1', ana, 10n, bruno, 'g-forged')],
      undefined,
    ],
    [
      'a grant naming another account’s grant counts for nothing',
      [grant('g1', bruno, 10n), grant('g2', ana, 20n, carla, 'g1')],
      undefined,
    ],
    [
      'a removal by an account that was never an admin counts for nothing',
      [grant('g1', ana, 10n), removal('r1', ana, 'g1', 20n, bruno, 'g-forged')],
      'g1',
    ],
    [
      'a removal of a grant no longer in force changes nothing',
      [
        grant('g1', ana, 10n),
        removal('r1', ana, 'g1', 20n),
        grant('g2', ana, 30n),
        removal('r2', ana, 'g1', 40n),
      ],
      'g2',
    ],
  ])('%s', (_name, rows, expected) => {
    expect(adminHistory(rows).liveGrant(ana)).toBe(expected);
  });

  it('lets a granted admin give and take away the role while their own grant is in force', () => {
    const rows = [
      grant('g1', ana, 10n),
      grant('g2', bruno, 20n, ana, 'g1'),
      removal('r1', ana, 'g1', 30n),
      // Ana's own grant ended at 30, so neither of these counts.
      grant('g3', carla, 40n, ana, 'g1'),
      removal('r2', bruno, 'g2', 50n, ana, 'g1'),
    ];
    const history = adminHistory(rows);
    expect(history.liveGrant(bruno)).toBe('g2');
    expect(history.liveGrant(carla)).toBeUndefined();
  });

  it('replays by time, not by the order the rows were read in', () => {
    const history = adminHistory([
      grant('g2', bruno, 20n, ana, 'g1'),
      removal('r1', ana, 'g1', 30n),
      grant('g1', ana, 10n),
    ]);
    expect(history.liveGrant(bruno)).toBe('g2');
    expect(history.liveGrant(ana)).toBeUndefined();
  });

  it.each<[string, bigint, boolean]>([
    ['before the grant', 9n, false],
    ['at the grant', 10n, true],
    ['while in force', 15n, true],
    ['at the removal', 20n, false],
    ['after the removal', 25n, false],
  ])('says a grant is in force %s only while it was', (_name, at, expected) => {
    const history = adminHistory([grant('g1', ana, 10n), removal('r1', ana, 'g1', 20n)]);
    expect(history.inForce('g1', ana, at)).toBe(expected);
  });

  it('never lends one account’s grant to another', () => {
    expect(adminHistory([grant('g1', ana, 10n)]).inForce('g1', bruno, 15n)).toBe(false);
  });

  it('keeps a microsecond apart: a removal one microsecond after a decision leaves it in force', () => {
    const at = 1_762_545_600_000_000n;
    const history = adminHistory([grant('g1', ana, at), removal('r1', ana, 'g1', at + 2n)]);
    expect(history.inForce('g1', ana, at + 1n)).toBe(true);
    expect(history.inForce('g1', ana, at + 2n)).toBe(false);
  });
});
