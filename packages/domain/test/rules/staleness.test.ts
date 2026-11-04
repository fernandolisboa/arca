import { describe, expect, it } from 'vitest';
import { parseCalendarDate } from '../../src/calendar/calendar-date.js';
import {
  type CatalogEntry,
  type DecisionState,
  type RouteCatalog,
  identityKey,
  stateOf,
} from '../../src/rules/catalog.js';
import { evaluateRoute } from '../../src/rules/engine.js';
import { staleSources } from '../../src/rules/staleness.js';
import { snapshot } from '../case/builders.js';
import { context, entry, sampleVersion } from './fixtures.js';

/** Synthetic sources only: invented hosts and dates. */
const source = (id: string, verifiedAt: string): object => ({
  id,
  url: `https://www.gov.example/${id}`,
  title: 'Residence act',
  kind: 'official',
  verifiedAt,
});

/** The sample version, its first requirement citing `cited` as well, and `uncited` beside it. */
function withSources(patch: object = {}): CatalogEntry {
  const [first, ...rest] = sampleVersion.requirements;
  return entry({
    sources: [
      source('law', '2026-10-01'),
      source('cited', '2026-08-01'),
      source('uncited', '2020-01-01'),
    ],
    requirements: [{ ...first, sources: ['law', 'cited'] }, ...rest],
    ...patch,
  });
}

const ids = (version: CatalogEntry, today: string) =>
  staleSources(version.version, parseCalendarDate(today)).map(({ source, daysSinceVerified }) => [
    source.id,
    daysSinceVerified,
  ]);

describe('staleSources', () => {
  it('lists a cited source verified more than 90 days before today', () => {
    expect(ids(withSources(), '2026-10-30')).toEqual([]);
    expect(ids(withSources(), '2026-10-31')).toEqual([['cited', 91]]);
  });

  it('ignores a source no rule cites', () => {
    expect(ids(withSources(), '2027-06-01').map(([id]) => id)).toEqual(['law', 'cited']);
  });

  it('counts closure sources', () => {
    const closed = entry({
      status: 'closed',
      sources: [source('law', '2026-10-01'), source('closure', '2025-01-01')],
      closureSources: ['closure'],
    });
    expect(ids(closed, '2026-11-03')).toEqual([['closure', 671]]);
  });
});

describe('the stale flag (spec 0002, R9)', () => {
  const resident = snapshot({ people: [{ id: 'p1', birthDate: '1980-01-01' }] });

  function evaluate(
    entries: readonly CatalogEntry[],
    rulesAsOf: string,
    decided: Record<number, DecisionState> = {},
  ) {
    const catalog: RouteCatalog = {
      identities: () => entries.map((each) => each.identity),
      activeEntry: (identity, states) =>
        stateOf(identity, states) === 'active'
          ? entries.find((each) => identityKey(each.identity) === identityKey(identity))
          : undefined,
    };
    const states = new Map(
      entries.map((each) => [
        identityKey(each.identity),
        decided[each.identity.number] ?? ('active' as const),
      ]),
    );
    const result = evaluateRoute(
      resident,
      catalog,
      'qm-sample',
      'p1',
      context({ rulesAsOf: parseCalendarDate(rulesAsOf), states }),
    );
    if (result.kind !== 'evaluated') throw new Error(`Expected an evaluation, got ${result.kind}`);
    return {
      stale: result.stale,
      version: result.evaluation.versionNumber,
      sources: result.evaluation.staleSources.map((stale) => stale.source.id),
    };
  }

  const old = withSources();
  const replacement = entry({ number: 2, effectiveFrom: '2026-06-01' });

  it('flags the version in effect today when it cites a stale source', () => {
    expect(evaluate([old], '2026-11-03')).toEqual({ stale: true, version: 1, sources: ['cited'] });
  });

  it('does not flag a version with fresh sources', () => {
    expect(evaluate([old, replacement], '2026-11-03')).toEqual({
      stale: false,
      version: 2,
      sources: [],
    });
  });

  it('never flags a superseded version reached through a past rulesAsOf', () => {
    expect(evaluate([old, replacement], '2026-01-01')).toEqual({
      stale: false,
      version: 1,
      sources: ['cited'],
    });
  });

  it('does not flag a version a pending one replaces today', () => {
    expect(evaluate([old, replacement], '2026-01-01', { 2: 'proposed' })).toMatchObject({
      stale: false,
      version: 1,
    });
  });
});
