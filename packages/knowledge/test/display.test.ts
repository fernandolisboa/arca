import { parseCalendarDate, versionView } from '@arca/domain';
import { describe, expect, it } from 'vitest';
import { displayCatalog } from '../src/display.ts';

const hostOf = (url: string) => new URL(url).hostname;
const routes = [...new Set(displayCatalog.entries().map(({ identity }) => identity.routeId))];

describe('the display catalog (spec 0007, R7)', () => {
  it('holds every seed version with its cases', () => {
    expect(routes.sort()).toEqual(['pt-d7', 'pt-d8', 'us-eb5']);
    for (const { identity } of displayCatalog.entries()) {
      expect(displayCatalog.cases(identity.hash).length).toBeGreaterThan(0);
    }
    expect(displayCatalog.cases('0'.repeat(64))).toEqual([]);
  });

  it.each(routes)(
    'lays out %s with every fact named and every source new to the route',
    (routeId) => {
      const [first] = displayCatalog.versions(routeId);
      if (first === undefined) throw new Error('no version');
      const view = versionView({
        versions: displayCatalog.versions(routeId),
        number: first.identity.number,
        cases: displayCatalog.cases(first.identity.hash),
        states: new Map(),
        today: parseCalendarDate('2026-11-06'),
        hostOf,
      });
      expect(view).toMatchObject({
        routeId,
        hash: first.identity.hash,
        state: 'proposed',
        replaces: null,
      });
      const facts = [
        ...(view?.requirements ?? []),
        ...(view?.dependents ?? []),
        ...(view?.costs ?? []),
      ].flatMap((item) => item.facts);
      expect(facts.length).toBeGreaterThan(0);
      expect(facts.filter(({ key }) => key === null)).toEqual([]);
      expect(view?.sources.every(({ newHost, url }) => newHost && url.startsWith('https://'))).toBe(
        true,
      );
      expect(view?.cases.length).toBeGreaterThan(0);
    },
  );
});
