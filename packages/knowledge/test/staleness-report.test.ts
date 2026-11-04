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

  it('writes identifiers only', () => {
    const date = parseCalendarDate('2026-12-15');
    const report = formatReport(staleRows(entries, date), date);
    expect(report).toContain(
      '| `qm-corrections` | `5` | `law` | `www.gov.example` | `2026-09-01` | `105` |',
    );
    expect(report).not.toContain('Fixture');
  });
});
