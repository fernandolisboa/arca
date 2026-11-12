import { describe, expect, it } from 'vitest';
import { checkRunItems, checkRunStepStatuses } from '../src/knowledge/check-run-steps.js';

type Progress = Parameters<typeof checkRunStepStatuses>[0];
const at = (
  state: Progress['state'],
  stage: Progress['stage'],
  locatedPages: number | null = null,
): Progress => ({ state, stage, locatedPages });

describe('checkRunStepStatuses', () => {
  it.each<[string, Progress, string[]]>([
    [
      'a start that said nothing yet',
      at('running', 'starting'),
      ['current', 'pending', 'pending', 'pending'],
    ],
    ['reading pages', at('running', 'reading'), ['current', 'pending', 'pending', 'pending']],
    ['picking passages', at('running', 'locating', 2), ['done', 'current', 'pending', 'pending']],
    [
      'comparing after long pages',
      at('running', 'comparing', 2),
      ['done', 'done', 'current', 'pending'],
    ],
    [
      'comparing with no long page',
      at('running', 'comparing'),
      ['done', 'skipped', 'current', 'pending'],
    ],
    ['finished', at('finished', 'comparing', 1), ['done', 'done', 'done', 'done']],
    [
      'finished with no long page',
      at('finished', 'comparing'),
      ['done', 'skipped', 'done', 'done'],
    ],
    [
      'finished with no page read',
      at('finished', 'reading'),
      ['done', 'skipped', 'skipped', 'done'],
    ],
    [
      'finished with no progress written',
      at('finished', 'starting'),
      ['done', 'skipped', 'skipped', 'done'],
    ],
    ['failed while reading', at('failed', 'reading'), ['stopped', 'pending', 'pending', 'pending']],
    ['dead while comparing', at('dead', 'comparing', 1), ['done', 'done', 'stopped', 'pending']],
    [
      'dead before it said anything',
      at('dead', 'starting'),
      ['stopped', 'pending', 'pending', 'pending'],
    ],
  ])('%s', (_, progress, expected) => {
    const statuses = checkRunStepStatuses(progress);
    expect([statuses.read, statuses.locate, statuses.compare, statuses.report]).toEqual(expected);
  });
});

describe('checkRunItems', () => {
  type ItemsProgress = Parameters<typeof checkRunItems>[0];
  const item = (key: string, status: 'matches' | 'differs' | null) => ({
    key,
    kind: 'requirement' as const,
    title: key,
    status,
  });
  const items = [item('a', 'matches'), item('b', 'differs'), item('c', null), item('d', null)];
  const progress = (over: Partial<ItemsProgress> = {}): ItemsProgress => ({
    items,
    scripted: false,
    state: 'running',
    ...over,
  });

  it('lists the answered items, the one awaited and how many follow it', () => {
    const view = checkRunItems(progress());
    expect(view.answered.map(({ key, status }) => [key, status])).toEqual([
      ['a', 'matches'],
      ['b', 'differs'],
    ]);
    expect(view.answered[0]).toMatchObject({ quotes: [], note: null, reason: null });
    expect(view.next?.key).toBe('c');
    expect(view.left).toBe(1);
  });

  it('awaits nothing once the check stopped', () => {
    const view = checkRunItems(progress({ state: 'failed' }));
    expect(view.next).toBeUndefined();
    expect(view.left).toBe(2);
  });

  it('shows a scripted match as not confirmed', () => {
    const view = checkRunItems(progress({ scripted: true }));
    expect(view.answered.map(({ status }) => status)).toEqual(['could_not_check', 'differs']);
  });

  it('shows nothing answered before the first answer lands', () => {
    const view = checkRunItems(progress({ items: [item('c', null)] }));
    expect(view.answered).toEqual([]);
    expect(view.next?.key).toBe('c');
    expect(view.left).toBe(0);
  });
});
