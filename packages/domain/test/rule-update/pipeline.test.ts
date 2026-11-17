import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CheckedItem } from '../../src/quote-check/answers.js';
import {
  type StageResult,
  type UpdateStage,
  itemOutcome,
  maxUpdateStages,
  nextUpdateStep,
  updateStages,
  validatorVerdict,
} from '../../src/rule-update/pipeline.js';

const done = (stage: UpdateStage, needsCorrection = false, proposalValid = true): StageResult => ({
  stage,
  failure: null,
  needsCorrection,
  proposalValid,
});

describe('nextUpdateStep', () => {
  it.each<[string, StageResult[], ReturnType<typeof nextUpdateStep>]>([
    ['starts with research', [], { kind: 'run', stage: 'research' }],
    ['validates after research', [done('research')], { kind: 'run', stage: 'validation' }],
    [
      'finishes when validation rejects nothing',
      [done('research'), done('validation')],
      { kind: 'finished' },
    ],
    [
      'corrects a rejection',
      [done('research'), done('validation', true)],
      { kind: 'run', stage: 'correction' },
    ],
    [
      'corrects an invalid proposal',
      [done('research'), done('validation', false, false)],
      { kind: 'run', stage: 'correction' },
    ],
    [
      'validates the correction',
      [done('research'), done('validation', true), done('correction')],
      { kind: 'run', stage: 'final_validation' },
    ],
    [
      'finishes after the final validation, rejections and all',
      [
        done('research'),
        done('validation', true),
        done('correction'),
        done('final_validation', true),
      ],
      { kind: 'finished' },
    ],
    [
      'fails a proposal still invalid at the end',
      [
        done('research'),
        done('validation', true),
        done('correction'),
        done('final_validation', true, false),
      ],
      { kind: 'failed', failure: 'proposal_invalid' },
    ],
    [
      'ends on a failed stage with its code',
      [done('research'), { stage: 'validation', failure: 'validation_failed' }],
      { kind: 'failed', failure: 'validation_failed' },
    ],
    [
      'refuses a stage out of order',
      [done('research'), done('correction')],
      { kind: 'failed', failure: 'out_of_order' },
    ],
    [
      'refuses a third round',
      [...updateStages.map((stage) => done(stage, true)), done('correction')],
      { kind: 'failed', failure: 'out_of_order' },
    ],
  ])('%s', (_, results, expected) => {
    expect(nextUpdateStep(results)).toEqual(expected);
  });

  const outcome = fc.oneof(
    fc.record({
      failure: fc.constant(null),
      needsCorrection: fc.boolean(),
      proposalValid: fc.boolean(),
    }),
    fc.record({
      failure: fc.constantFrom('research_failed' as const, 'validation_failed' as const),
    }),
  );

  it('ends within two rounds whatever each stage answers', () => {
    fc.assert(
      fc.property(fc.array(outcome, { maxLength: 8 }), (outcomes) => {
        const results: StageResult[] = [];
        for (const answer of outcomes) {
          const step = nextUpdateStep(results);
          if (step.kind !== 'run') break;
          results.push({ stage: step.stage, ...answer });
        }
        expect(results.length).toBeLessThanOrEqual(maxUpdateStages);
        if (results.length === outcomes.length && results.length < maxUpdateStages) return;
        expect(nextUpdateStep(results).kind).not.toBe('run');
      }),
    );
  });

  it('never skips the correction after a rejection', () => {
    fc.assert(
      fc.property(fc.boolean(), (proposalValid) => {
        const step = nextUpdateStep([done('research'), done('validation', true, proposalValid)]);
        expect(step).toEqual({ kind: 'run', stage: 'correction' });
      }),
    );
  });
});

describe('validatorVerdict', () => {
  it.each([
    ['supports', 0.9, 'supports'],
    ['contradicts', 0.5, 'contradicts'],
    ['supports', 0.49, 'cannot_tell'],
    ['contradicts', Number.NaN, 'cannot_tell'],
  ] as const)('%s at %d is %s', (choice, confidence, expected) => {
    expect(validatorVerdict(choice, confidence)).toBe(expected);
  });
});

describe('itemOutcome', () => {
  const matched: CheckedItem = {
    key: 'cost:fee',
    status: 'matches',
    quotes: [],
    note: null,
    reason: null,
  };
  const unchecked = (reason: CheckedItem['reason']): CheckedItem => ({
    key: 'cost:fee',
    status: 'could_not_check',
    quotes: [],
    note: null,
    reason,
  });

  it.each<[string, CheckedItem, Parameters<typeof itemOutcome>[1], string, string | null]>([
    ['confirms a verified quote the validator supports', matched, 'supports', 'confirmed', null],
    [
      'diverges when the validator contradicts',
      matched,
      'contradicts',
      'divergent',
      'validator_contradicts',
    ],
    [
      'leaves a doubtful answer unconfirmed',
      matched,
      'cannot_tell',
      'unconfirmed',
      'validator_cannot_tell',
    ],
    [
      'leaves an unasked item unconfirmed',
      matched,
      undefined,
      'unconfirmed',
      'validator_cannot_tell',
    ],
    [
      'diverges on a fabricated quote whatever the validator says',
      unchecked('quote_not_on_page'),
      'supports',
      'divergent',
      'quote_not_on_page',
    ],
    [
      'diverges on a value the quote lacks',
      unchecked('value_not_in_quote'),
      undefined,
      'divergent',
      'value_not_in_quote',
    ],
    [
      'leaves an unread page unconfirmed',
      unchecked('page_not_read'),
      undefined,
      'unconfirmed',
      'page_not_read',
    ],
    ['leaves a cut page unconfirmed', unchecked('page_cut'), 'supports', 'unconfirmed', 'page_cut'],
  ])('%s', (_, checked, verdict, list, reason) => {
    expect(itemOutcome(checked, verdict)).toEqual({ key: 'cost:fee', list, reason });
  });
});
