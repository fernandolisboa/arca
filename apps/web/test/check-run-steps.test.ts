import { describe, expect, it } from 'vitest';
import { checkRunStepStatuses } from '../src/knowledge/check-run-steps.js';

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
