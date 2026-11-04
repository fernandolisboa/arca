import { parseCalendarDate } from '@arca/domain';
import { describe, expect, it } from 'vitest';
import { formatReport, staleRows } from '../scripts/staleness-report.ts';
import { fixtureEntries } from './data.ts';

const entries = await fixtureEntries();

describe('staleness report (spec 0002, R9)', () => {
  it('lists nothing while every source is fresh', () => {
    const date = parseCalendarDate('2026-11-03');
    expect(staleRows(entries, date)).toEqual([]);
    expect(formatReport([], date)).toContain('No stale sources.');
  });

  it('lists the stale sources of the version each route selects, every version active', () => {
    const rows = staleRows(entries, parseCalendarDate('2026-12-15'));
    const routes = new Set([...entries.values()].map((entry) => entry.identity.routeId));
    expect(new Set(rows.map((row) => row.routeId))).toEqual(routes);
    expect(rows.find((row) => row.routeId === 'qm-corrections')).toEqual({
      routeId: 'qm-corrections',
      version: 5,
      sourceId: 'law',
      host: 'www.gov.example',
      verifiedAt: '2026-09-01',
      daysSinceVerified: 105,
    });
    expect(rows.find((row) => row.routeId === 'qm-closure-proposed')?.version).toBe(2);
  });

  it('lists the stale sources of a pinned country set, naming the set', () => {
    const rows = staleRows(entries, parseCalendarDate('2026-12-15'));
    expect(rows.filter((row) => row.countrySet !== undefined)).toEqual([
      {
        routeId: 'qp-treaty-investor',
        version: 1,
        countrySet: 'treaty/1',
        sourceId: 'law',
        host: 'www.gov.example',
        verifiedAt: '2026-09-01',
        daysSinceVerified: 105,
      },
    ]);
  });

  it('writes a host with any character outside plain DNS names as unparsable', () => {
    const [first] = [...entries.values()].filter(
      (entry) => entry.identity.routeId === 'qm-replaced',
    );
    if (first === undefined) throw new Error('The replaced fixture route is missing');
    const crafted = {
      ...first,
      identity: { ...first.identity, routeId: 'qm-crafted' },
      version: {
        ...first.version,
        sources: first.version.sources.map((source) => ({
          ...source,
          url: 'https://a`b.example/law',
        })),
      },
    };
    const rows = staleRows(new Map([['crafted', crafted]]), parseCalendarDate('2027-06-01'));
    expect(rows.map((row) => row.host)).toEqual(['unparsable']);
  });

  it('writes identifiers only', () => {
    const date = parseCalendarDate('2026-12-15');
    const report = formatReport(staleRows(entries, date), date);
    expect(report).toContain(
      '| `qm-corrections` | `5` | `-` | `law` | `www.gov.example` | `2026-09-01` | `105` |',
    );
    expect(report).not.toContain('Fixture');
  });
});
