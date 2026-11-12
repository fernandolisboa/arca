import { describe, expect, it } from 'vitest';
import {
  type CheckProgress,
  type CheckProgressEvent,
  checkProgress,
} from '../../src/independent-check/progress.js';

const minute = 60_000;
const now = 1_000 * minute;
const start = { id: 'start-1', startedAt: now - 2 * minute };
const law = 'https://www.gov.example/law';
const fees = 'https://fees.gov.example/table';

const started: CheckProgressEvent = { kind: 'started', items: 4, pages: 2 };
const reading = (url: string): CheckProgressEvent => ({
  kind: 'page',
  url,
  outcome: 'reading',
  status: null,
});
const read = (url: string): CheckProgressEvent => ({
  kind: 'page',
  url,
  outcome: 'read',
  status: 200,
});

const empty: CheckProgress = {
  startedAt: start.startedAt,
  state: 'running',
  stage: 'starting',
  itemCount: null,
  pageCount: null,
  pages: [],
  locatedPages: null,
  items: [],
  failure: null,
};
const counted = { itemCount: 4, pageCount: 2 };

describe('checkProgress', () => {
  it.each<[string, CheckProgressEvent[], boolean, number, Partial<CheckProgress>]>([
    ['a start that recorded nothing yet', [], false, now, {}],
    ['a check that began', [started], false, now, { stage: 'reading', ...counted }],
    [
      'a page being read',
      [started, reading(law)],
      false,
      now,
      { stage: 'reading', ...counted, pages: [{ url: law, outcome: 'reading', status: null }] },
    ],
    [
      'pages with their latest outcome, in the order first read',
      [
        started,
        reading(law),
        read(law),
        reading(fees),
        { kind: 'page', url: fees, outcome: 'http_status', status: 503 },
      ],
      false,
      now,
      {
        stage: 'reading',
        ...counted,
        pages: [
          { url: law, outcome: 'read', status: 200 },
          { url: fees, outcome: 'http_status', status: 503 },
        ],
      },
    ],
    [
      'passages being picked',
      [started, { kind: 'locating', pages: 1 }],
      false,
      now,
      { stage: 'locating', ...counted, locatedPages: 1 },
    ],
    [
      'the comparison',
      [started, { kind: 'locating', pages: 1 }, { kind: 'comparing' }],
      false,
      now,
      { stage: 'comparing', ...counted, locatedPages: 1 },
    ],
    [
      'a finished check',
      [started, { kind: 'comparing' }, { kind: 'finished' }],
      true,
      now,
      { state: 'finished', stage: 'comparing', ...counted },
    ],
    [
      'a finished check whose last progress write failed',
      [started, { kind: 'comparing' }],
      true,
      now,
      { state: 'finished', stage: 'comparing', ...counted },
    ],
    [
      'a finished check whose report is not listed yet',
      [started, { kind: 'finished' }],
      false,
      now,
      { state: 'finished', stage: 'reading', ...counted },
    ],
    [
      'a failed check',
      [started, { kind: 'failed', code: 'check_failed' }],
      false,
      now,
      { state: 'failed', stage: 'reading', ...counted, failure: 'check_failed' },
    ],
    [
      'a failed check long after',
      [{ kind: 'failed', code: 'check_unknown_version' }],
      false,
      now + 60 * minute,
      { state: 'failed', failure: 'check_unknown_version' },
    ],
    [
      'a report over a recorded failure',
      [started, { kind: 'failed', code: 'check_failed' }],
      true,
      now,
      { state: 'finished', stage: 'reading', ...counted },
    ],
    ['a start still young at 29 minutes', [], false, start.startedAt + 29 * minute, {}],
    [
      'a dead start at 30 minutes',
      [started],
      false,
      start.startedAt + 30 * minute,
      { state: 'dead', stage: 'reading', ...counted },
    ],
    ['an old start that reported', [], true, start.startedAt + 90 * minute, { state: 'finished' }],
  ])('shows %s', (_, events, reported, time, expected) => {
    expect(checkProgress(start, events, reported, time, [])).toEqual({ ...empty, ...expected });
  });

  describe('items', () => {
    const items = [
      { key: 'requirement:means', kind: 'requirement', title: 'Means' },
      { key: 'cost:fee', kind: 'cost', title: 'Fee' },
    ] as const;
    const item = (key: string, status: 'matches' | 'differs' | 'could_not_check') =>
      ({ kind: 'item', key, status }) satisfies CheckProgressEvent;
    const statusesOf = (events: CheckProgressEvent[]) =>
      checkProgress(start, events, false, now, items).items.map(({ key, status }) => [key, status]);

    it('lists every item in its order, each awaited until answered', () => {
      expect(
        checkProgress(start, [started, { kind: 'comparing' }], false, now, items).items,
      ).toEqual([
        { key: 'requirement:means', kind: 'requirement', title: 'Means', status: null },
        { key: 'cost:fee', kind: 'cost', title: 'Fee', status: null },
      ]);
    });

    it.each<[string, CheckProgressEvent[], [string, string | null][]]>([
      [
        'an answered item',
        [{ kind: 'comparing' }, item('cost:fee', 'differs')],
        [
          ['requirement:means', null],
          ['cost:fee', 'differs'],
        ],
      ],
      [
        'the latest answer of an item asked for again',
        [item('requirement:means', 'matches'), item('requirement:means', 'could_not_check')],
        [
          ['requirement:means', 'could_not_check'],
          ['cost:fee', null],
        ],
      ],
      [
        'nothing of a comparison asked for again, until it answers',
        [
          { kind: 'comparing' },
          item('requirement:means', 'matches'),
          { kind: 'comparing' },
          item('cost:fee', 'differs'),
        ],
        [
          ['requirement:means', null],
          ['cost:fee', 'differs'],
        ],
      ],
      [
        'nothing of a key no item has',
        [item('requirement:other', 'matches')],
        [
          ['requirement:means', null],
          ['cost:fee', null],
        ],
      ],
    ])('shows %s', (_, events, expected) => {
      expect(statusesOf(events)).toEqual(expected);
    });

    it('keeps the stage where the items land', () => {
      expect(
        checkProgress(
          start,
          [started, { kind: 'comparing' }, item('cost:fee', 'matches')],
          false,
          now,
          items,
        ).stage,
      ).toBe('comparing');
    });
  });
});
