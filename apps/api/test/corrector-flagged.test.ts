import type { KnowledgeVersion } from '@arca/api-contract/routes';
import { parseCalendarDate } from '@arca/domain';
import { describe, expect, it } from 'vitest';
import { type ListedCheck, type ReportOutcome, flaggedVersions } from '../src/knowledge/checks.js';

// The flagged versions the corrector run takes up unasked (ADR-0029). Synthetic routes only.
type Listed = Omit<KnowledgeVersion, 'check' | 'points'>;

const version = (routeId: string, number: number, overrides: Partial<Listed> = {}): Listed => ({
  routeId,
  number,
  title: `${routeId} ${String(number)}`,
  country: 'QM',
  effectiveFrom: parseCalendarDate('2026-01-01'),
  hash: String(number).repeat(64),
  state: 'proposed',
  superseded: false,
  ...overrides,
});

const item = (key: string, status: 'matches' | 'differs' | 'could_not_check') => ({
  key,
  kind: 'requirement' as const,
  title: key,
  status,
  quotes: [],
  note: status === 'matches' ? null : 'model text that never leaves the report',
  reason: status === 'could_not_check' ? ('no_page_read' as const) : null,
  citations: [],
  values: [],
});

function setup(listed: readonly Listed[], statuses: Record<string, ListedCheck['status']>) {
  const reported: string[] = [];
  const versions = { list: () => Promise.resolve(listed) };
  const checks = {
    statuses: () =>
      Promise.resolve(
        new Map(Object.entries(statuses).map(([key, status]) => [key, { status, points: null }])),
      ),
    report: (routeId: string, number: number): Promise<ReportOutcome> => {
      reported.push(`${routeId}/${String(number)}`);
      return Promise.resolve({
        ok: true,
        status: 'flagged',
        report: {
          checkedAt: Date.parse('2026-11-13T10:00:00Z'),
          clean: false,
          scripted: false,
          failure: null,
          guide: null,
          items: [item('a', 'matches'), item('b', 'differs'), item('c', 'could_not_check')],
          fetchLog: [],
        },
      });
    },
  };
  return { run: () => flaggedVersions(versions, checks), reported };
}

describe('the flagged versions for the corrector run', () => {
  it('list each proposed, not superseded, flagged version with its items that did not match, as codes', async () => {
    const { run } = setup([version('qm-one', 2), version('qm-two', 1)], {
      'qm-one/2': 'flagged',
      'qm-two/1': 'checked',
    });
    expect(await run()).toEqual({
      versions: [
        {
          routeId: 'qm-one',
          number: 2,
          checkedAt: '2026-11-13T10:00:00.000Z',
          items: [
            { key: 'b', kind: 'requirement', status: 'differs', reason: null },
            { key: 'c', kind: 'requirement', status: 'could_not_check', reason: 'no_page_read' },
          ],
        },
      ],
    });
  });

  it('leave out decided and superseded versions, and those with no current flagged report', async () => {
    const { run, reported } = setup(
      [
        version('qm-one', 1, { state: 'active' }),
        version('qm-one', 2, { superseded: true }),
        version('qm-two', 1, { state: 'rejected' }),
        version('qm-three', 1),
        version('qm-four', 1),
      ],
      {
        'qm-one/1': 'flagged',
        'qm-one/2': 'flagged',
        'qm-two/1': 'flagged',
        'qm-three/1': 'stale',
      },
    );
    expect(await run()).toEqual({ versions: [] });
    expect(reported).toEqual([]);
  });
});
