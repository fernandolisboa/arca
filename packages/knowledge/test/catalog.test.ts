import {
  type CatalogEntry,
  type DecisionStates,
  caseSnapshotSchema,
  evaluateRoute,
  fxTableSchema,
  identityKey,
  parseCalendarDate,
} from '@arca/domain';
import { describe, expect, it } from 'vitest';
import { createRouteCatalog } from '../src/catalog.ts';
import { parseEntries } from '../src/entries.ts';
import { baseTree, builtEntries, routeVersion } from './data.ts';

function twoVersions(): Record<string, unknown> {
  return {
    ...baseTree(),
    'routes/qm-work/2.json': routeVersion({ number: 2, effectiveFrom: '2024-01-01' }),
  };
}

const states = (entries: ReadonlyMap<string, CatalogEntry>, active: number[]): DecisionStates =>
  new Map(
    [...entries.values()]
      .filter((entry) => active.includes(entry.identity.number))
      .map((entry) => [identityKey(entry.identity), 'active']),
  );

describe('createRouteCatalog', () => {
  it('exposes the identity of every version of a route, and none of another', async () => {
    const catalog = createRouteCatalog(await builtEntries(twoVersions()));
    expect(catalog.identities('qm-work').map((identity) => identity.number)).toEqual([1, 2]);
    expect(catalog.identities('qm-other')).toEqual([]);
  });

  it('gives a full entry only for an active version', async () => {
    const entries = await builtEntries(twoVersions());
    const catalog = createRouteCatalog(entries);
    const [first, second] = catalog.identities('qm-work');
    if (first === undefined || second === undefined) throw new Error('Two versions expected');
    const decided = states(entries, [1]);
    expect(catalog.activeEntry(first, decided)?.identity).toEqual(first);
    expect(catalog.activeEntry(second, decided)).toBeUndefined();
    expect(catalog.activeEntry(first, new Map([[identityKey(first), 'rejected']]))).toBeUndefined();
  });

  it('never matches an activation of other content', async () => {
    const entries = await builtEntries();
    const catalog = createRouteCatalog(entries);
    const [identity] = catalog.identities('qm-work');
    if (identity === undefined) throw new Error('One version expected');
    const otherHash = { ...identity, hash: 'a'.repeat(64) };
    expect(
      catalog.activeEntry(otherHash, new Map([[identityKey(otherHash), 'active']])),
    ).toBeUndefined();
  });

  it('feeds the engine, which waits for activation', async () => {
    const entries = await builtEntries();
    const catalog = createRouteCatalog(entries);
    const snapshot = caseSnapshotSchema.parse({
      recordedOn: '2026-11-03',
      members: ['p1'],
      people: [
        {
          id: 'p1',
          birthDate: '1990-05-01',
          citizenships: [{ country: 'QN', basis: 'birth', lost: 'none' }],
        },
      ],
      relationships: [],
      assets: [],
    });
    const date = parseCalendarDate('2026-11-03');
    const context = {
      rulesAsOf: date,
      today: date,
      fx: fxTableSchema.parse({ rates: [] }),
      engineCommit: 'test',
    };
    const pending = evaluateRoute(snapshot, catalog, 'qm-work', 'p1', {
      ...context,
      states: new Map(),
    });
    expect(pending.kind).toBe('pending');
    const evaluated = evaluateRoute(snapshot, catalog, 'qm-work', 'p1', {
      ...context,
      states: states(entries, [1]),
    });
    expect(evaluated.kind === 'evaluated' && evaluated.status).toBe('eligible');
  });
});

describe('parseEntries', () => {
  it('refuses data that is not a built catalog', () => {
    expect(() => parseEntries([{ hash: 'nope', version: {}, countrySets: [] }])).toThrow();
  });
});
