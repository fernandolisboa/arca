import { comparisonIdentityKey, identityKey, parseCalendarDate } from '@arca/domain';
import { displayCatalog } from '@arca/knowledge/display';
import { describe, expect, it } from 'vitest';
import { ComparisonVersionView, VersionView } from '@arca/api-contract/routes';
import { todayInSaoPaulo } from '../src/calendar.js';
import { createKnowledgeVersions } from '../src/knowledge/versions.js';

const [first] = displayCatalog.entries();
if (first === undefined) throw new Error('the catalog is empty');
const versions = createKnowledgeVersions({
  states: () => Promise.resolve(new Map([[identityKey(first.identity), 'active' as const]])),
  today: () => parseCalendarDate('2026-11-06'),
});

describe('the activation screen reads (spec 0007, R7)', () => {
  it('lists every bundled version with its state, the newest first', async () => {
    const listed = await versions.list();
    expect(listed).toHaveLength(displayCatalog.entries().length);
    const dates = listed.map(({ effectiveFrom }) => effectiveFrom);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(
      listed.find(
        ({ routeId, number }) =>
          routeId === first.identity.routeId && number === first.identity.number,
      ),
    ).toMatchObject({ state: 'active', title: first.version.title, hash: first.identity.hash });
    expect(listed.filter(({ state }) => state === 'proposed')).toHaveLength(listed.length - 1);
  });

  it("views one version with its state and today's selection", async () => {
    const view = await versions.view(first.identity.routeId, first.identity.number);
    expect(view).toMatchObject({
      routeId: first.identity.routeId,
      state: 'active',
      rejection: { selected: true, fallback: null },
    });
    expect(await versions.view(first.identity.routeId, 99)).toBeUndefined();
    expect(await versions.view('qm-none', 1)).toBeUndefined();
  });

  it('answers every bundled version in the shape of the contract', async () => {
    for (const { identity } of displayCatalog.entries()) {
      const view = await versions.view(identity.routeId, identity.number);
      expect(VersionView.safeParse(view).error).toBeUndefined();
      expect(view?.sources.every(({ host }) => host !== null)).toBe(true);
    }
  });

  it('lists every bundled comparison version, proposed until decided (ADR-0026)', async () => {
    const listed = await versions.comparisons();
    expect(listed).toHaveLength(displayCatalog.comparisons().length);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every(({ state }) => state === 'proposed')).toBe(true);
    const numbers = listed.map(({ number }) => number);
    expect(numbers).toEqual([...numbers].sort((left, right) => right - left));
  });

  it('views every bundled comparison version in the shape of the contract', async () => {
    for (const { identity } of displayCatalog.comparisons()) {
      const view = await versions.comparisonView(identity.comparisonId, identity.number);
      expect(ComparisonVersionView.safeParse(view).error).toBeUndefined();
      expect(
        view?.indicators.flatMap(({ values }) => values).every(({ host }) => host !== null),
      ).toBe(true);
    }
    expect(await versions.comparisonView('destinations', 99)).toBeUndefined();
    expect(await versions.comparisonView('qm-none', 1)).toBeUndefined();
  });

  it('reads a comparison decision only under its own key', async () => {
    const [comparison] = displayCatalog.comparisons();
    if (comparison === undefined) throw new Error('no comparison version');
    const decided = createKnowledgeVersions({
      states: () =>
        Promise.resolve(new Map([[comparisonIdentityKey(comparison.identity), 'active' as const]])),
      today: () => parseCalendarDate('2026-11-06'),
    });
    const [listed] = await decided.comparisons();
    expect(listed?.state).toBe('active');
    expect((await decided.list()).every(({ state }) => state === 'proposed')).toBe(true);
  });

  it('takes the date in São Paulo', () => {
    expect(todayInSaoPaulo(new Date('2026-11-07T02:00:00Z'))).toBe('2026-11-06');
    expect(todayInSaoPaulo(new Date('2026-11-07T03:00:00Z'))).toBe('2026-11-07');
  });
});
