import { describe, expect, it } from 'vitest';
import {
  type ReportKey,
  type ReportMeta,
  type StartCandidate,
  currentReport,
  listedCheckStatus,
  maxAutomaticStartsPerDay,
  maxStartsPerDay,
  requestedStart,
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
      'flagged when a clean report follows a flagged one of the same key',
      [report({ clean: false }), report({ startId: 'start-2', checkedAt: now - minute })],
      [],
      'flagged',
    ],
    [
      'checked when the flagged one was for older content',
      [
        report({ clean: false, contentHash: 'b'.repeat(64) }),
        report({ startId: 'start-2', checkedAt: now - minute }),
      ],
      [],
      'checked',
    ],
    [
      'checked once the flagged one outlived its lifetime',
      [
        report({ clean: false, failed: true, checkedAt: now - day - minute }),
        report({ startId: 'start-2', checkedAt: now - minute }),
      ],
      [],
      'checked',
    ],
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

  it('stays within the automatic share of the last 24 hours, leaving the rest to an admin', () => {
    const candidates = Array.from({ length: 30 }, (_, index) => candidate(index + 1));
    expect(maxAutomaticStartsPerDay).toBe(15);
    expect(versionsToStart(candidates, 0, now)).toHaveLength(maxAutomaticStartsPerDay);
    expect(versionsToStart(candidates, maxAutomaticStartsPerDay - 3, now)).toHaveLength(3);
    expect(versionsToStart(candidates, maxAutomaticStartsPerDay, now)).toHaveLength(0);
    expect(versionsToStart(candidates, maxStartsPerDay + 5, now)).toHaveLength(0);
  });
});

describe('requestedStart', () => {
  const live = { id: 'start-9', startedAt: now - 5 * minute };
  const newerLive = { id: 'start-10', startedAt: now - minute };
  const dead = { id: 'start-8', startedAt: now - 31 * minute };
  it.each<[string, { id: string; startedAt: number }[], { startId: string }[], number, unknown]>([
    ['starts with nothing before', [], [], 0, { outcome: 'start' }],
    ['starts over a current report', [], [report()], 3, { outcome: 'start' }],
    ['starts past the automatic share', [], [], maxAutomaticStartsPerDay, { outcome: 'start' }],
    ['starts with one start left', [], [], maxStartsPerDay - 1, { outcome: 'start' }],
    ['is limited at the cap', [], [], maxStartsPerDay, { outcome: 'limit' }],
    ['answers the live start', [live], [], 1, { outcome: 'live', start: live }],
    [
      'answers the live start even at the cap',
      [live],
      [],
      maxStartsPerDay,
      {
        outcome: 'live',
        start: live,
      },
    ],
    [
      'answers the newest live start',
      [live, newerLive],
      [],
      2,
      {
        outcome: 'live',
        start: newerLive,
      },
    ],
    ['starts after a dead start', [dead], [], 1, { outcome: 'start' }],
    ['starts after its start reported', [live], [{ startId: 'start-9' }], 1, { outcome: 'start' }],
  ])('%s', (_, starts, reports, inWindow, expected) => {
    expect(requestedStart(starts, reports, inWindow, now)).toEqual(expected);
  });
});
