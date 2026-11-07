import { describe, expect, it } from 'vitest';
import {
  type ReportKey,
  type ReportMeta,
  type StartCandidate,
  currentReport,
  listedCheckStatus,
  maxStartsPerDay,
  versionsToStart,
} from '../../src/independent-check/reports.js';

const minute = 60_000;
const day = 24 * 60 * minute;
const now = 100 * day;

const key: ReportKey = {
  contentHash: 'a'.repeat(64),
  guideHash: 'none',
  promptVersion: 'p-1',
  model: 'm',
};

const report = (patch: Partial<ReportMeta & { clean: boolean }> = {}) => ({
  ...key,
  startId: 'start-1',
  checkedAt: now - day,
  failed: false,
  clean: true,
  ...patch,
});

describe('currentReport', () => {
  it.each<[string, ReturnType<typeof report>[], string | undefined]>([
    ['a report of today’s key', [report()], 'start-1'],
    [
      'the newest of two',
      [report(), report({ startId: 'start-2', checkedAt: now - minute })],
      'start-2',
    ],
    ['none for another content', [report({ contentHash: 'b'.repeat(64) })], undefined],
    ['none for another guide', [report({ guideHash: 'c'.repeat(64) })], undefined],
    ['none for another prompt', [report({ promptVersion: 'p-2' })], undefined],
    ['none for another model', [report({ model: 'n' })], undefined],
    ['none 30 days on', [report({ checkedAt: now - 30 * day })], undefined],
    ['one 29 days on', [report({ checkedAt: now - 29 * day })], 'start-1'],
    ['none a day after a failure', [report({ failed: true, checkedAt: now - day })], undefined],
    [
      'one hours after a failure',
      [report({ failed: true, checkedAt: now - 60 * minute })],
      'start-1',
    ],
  ])('finds %s', (_, reports, expected) => {
    expect(currentReport(reports, key, now)?.startId).toBe(expected);
  });
});

describe('listedCheckStatus', () => {
  const live = { id: 'start-9', startedAt: now - 5 * minute };
  const dead = { id: 'start-9', startedAt: now - 31 * minute };
  it.each<[string, ReturnType<typeof report>[], { id: string; startedAt: number }[], string]>([
    ['checked by a clean current report', [report()], [live], 'checked'],
    ['flagged by a current report not clean', [report({ clean: false })], [], 'flagged'],
    ['running while a start is live', [], [live], 'running'],
    ['running over a stale report', [report({ model: 'n' })], [live], 'running'],
    ['stale with only an older report', [report({ model: 'n' })], [dead], 'stale'],
    ['none with nothing', [], [dead], 'none'],
    [
      'not running once its start reported',
      [report({ startId: 'start-9', model: 'n' })],
      [live],
      'stale',
    ],
  ])('is %s', (_, reports, starts, expected) => {
    expect(listedCheckStatus(reports, starts, key, now)).toBe(expected);
  });
});

describe('versionsToStart', () => {
  const candidate = (number: number, patch: Partial<StartCandidate> = {}): StartCandidate => ({
    routeId: 'qm-sample',
    number,
    key,
    reports: [],
    starts: [],
    ...patch,
  });

  it('starts versions with no current report and no live start, in order', () => {
    const picked = versionsToStart(
      [
        candidate(1),
        candidate(2, { reports: [report()] }),
        candidate(3, { starts: [{ id: 's', startedAt: now - minute }] }),
        candidate(4, { starts: [{ id: 's', startedAt: now - 31 * minute }] }),
        candidate(5, { reports: [report({ checkedAt: now - 31 * day })] }),
      ],
      0,
      now,
    );
    expect(picked.map(({ number }) => number)).toEqual([1, 4, 5]);
  });

  it('stays within the starts left in the last 24 hours', () => {
    const candidates = Array.from({ length: 30 }, (_, index) => candidate(index + 1));
    expect(versionsToStart(candidates, 0, now)).toHaveLength(maxStartsPerDay);
    expect(versionsToStart(candidates, maxStartsPerDay - 3, now)).toHaveLength(3);
    expect(versionsToStart(candidates, maxStartsPerDay + 5, now)).toHaveLength(0);
  });
});
