// The intake evaluation's cases and scoring (spec 0008, R5), checked without calling a model.
import { keepStatedDates, maskIntakeText, parseIntakeDraft, renameDraft } from '@arca/domain';
import { describe, expect, it } from 'vitest';
import { draftAttempts } from '../src/case/intake.js';
import type { Extractor } from '../src/intake/extractor.js';
import { CallLimitReached, maxCallsPerRun, withCallLimit } from './eval/intake/call-limit.js';
import { draftOf, intakeCases } from './eval/intake/cases.js';
import { type Baseline, type CaseRun, judge, report } from './eval/intake/report.js';
import {
  emptyFields,
  factsOf,
  forbiddenIn,
  precision,
  scoreDraft,
  totals,
} from './eval/intake/score.js';

describe('the intake evaluation cases', () => {
  it('has at least 20 cases, each with its own ID', () => {
    expect(intakeCases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(intakeCases.map(({ id }) => id)).size).toBe(intakeCases.length);
  });

  it.each(intakeCases)('$id expects a draft the API could answer', (evalCase) => {
    const { masked } = maskIntakeText(evalCase.text, evalCase.people);
    // Each known person as a placeholder, so the draft parses as the model's reply would.
    const known = new Map(evalCase.people.map(({ id }, index) => [id, `[P${String(index + 1)}]`]));
    const asSent = renameDraft(evalCase.expected, (ref) => known.get(ref) ?? ref);
    const parsed = parseIntakeDraft(asSent, new Set(known.values()));
    expect(parsed).toEqual(asSent);
    // Every expected date is one the text states, at the precision it states it.
    expect(keepStatedDates(asSent, masked)).toEqual(asSent);
    for (const secret of evalCase.neverSent ?? []) expect(masked).not.toContain(secret);
    // A forbidden pattern never matches a fact the case expects.
    const expected = [...factsOf(evalCase.expected, new Set(evalCase.unscoredRoles)).keys()];
    for (const pattern of evalCase.forbidden ?? []) {
      expect(expected.filter((key) => pattern.test(key))).toEqual([]);
    }
  });
});

describe('the call limit of a run', () => {
  it('fits every case with its retry', () => {
    expect(intakeCases.length * draftAttempts).toBeLessThanOrEqual(maxCallsPerRun);
  });

  it('counts each call and refuses the one past the limit', async () => {
    const reply = { reply: {}, model: 'model', promptVersion: 'prompt' };
    const fake: Extractor = { draft: () => Promise.resolve(reply) };
    const { extractor, calls } = withCallLimit(fake, 2);
    await extractor.draft('a', []);
    await extractor.draft('b', []);
    await expect(extractor.draft('c', [])).rejects.toBeInstanceOf(CallLimitReached);
    expect(calls()).toBe(2);
  });

  it('counts a call that fails', async () => {
    const failing: Extractor = { draft: () => Promise.reject(new Error('down')) };
    const { extractor, calls } = withCallLimit(failing, 1);
    await expect(extractor.draft('a', [])).rejects.toThrow('down');
    await expect(extractor.draft('b', [])).rejects.toBeInstanceOf(CallLimitReached);
    expect(calls()).toBe(1);
  });
});

describe('scoring a draft', () => {
  const expected = draftOf({
    people: [
      { ref: 'writer', birthDate: '1980' },
      { ref: 'n1', role: 'spouse', citizenships: ['IT'] },
      { ref: 'n2', role: 'child', birthDate: '2010' },
    ],
    relationships: [
      { kind: 'spouse', people: ['writer', 'n1'], start: '2005' },
      { kind: 'parent', parent: 'n1', child: 'n2' },
    ],
  });

  it('scores the expected draft as all right', () => {
    const score = scoreDraft(expected, expected);
    expect([score.wrong, score.missed]).toEqual([[], []]);
    expect(totals([score]).all).toEqual({ hits: 10, wrong: 0, missed: 0 });
  });

  it('matches new people however the model numbered them', () => {
    const renumbered = renameDraft(expected, (ref) => ({ n1: 'n2', n2: 'n1' })[ref] ?? ref);
    expect(totals([scoreDraft(renumbered, expected)]).all.wrong).toBe(0);
  });

  it('counts a wrong fact, an extra person and a missed fact', () => {
    const actual = draftOf({
      people: [
        { ref: 'writer', birthDate: '1981' },
        { ref: 'n1', role: 'spouse', citizenships: ['IT'] },
        { ref: 'n2', role: 'child', birthDate: '2010' },
        { ref: 'n3', role: 'parent' },
      ],
      relationships: [
        { kind: 'spouse', people: ['n1', 'writer'], start: '2005' },
        { kind: 'parent', parent: 'n1', child: 'n2' },
      ],
    });
    const score = scoreDraft(actual, expected);
    expect(score.wrong).toEqual([
      'birthDate: writer 1981',
      'people: extra:n3',
      'role: extra:n3 parent',
    ]);
    expect(score.missed).toEqual(['birthDate: writer 1980']);
  });

  it('leaves a role the case keeps open unscored', () => {
    const actual = draftOf({ people: [{ ref: 'n1', role: 'other' }], relationships: [] });
    const open = draftOf({ people: [{ ref: 'n1' }], relationships: [] });
    expect(scoreDraft(actual, open, new Set(['n1'])).wrong).toEqual([]);
    expect(scoreDraft(actual, open).wrong).toEqual(['role: n1 other']);
  });

  it('counts a fact the draft repeats once', () => {
    const twice = draftOf({
      people: [{ ref: 'writer' }, { ref: 'n1', role: 'spouse' }],
      relationships: [
        { kind: 'spouse', people: ['writer', 'n1'] },
        { kind: 'spouse', people: ['n1', 'writer'] },
      ],
    });
    expect(totals([scoreDraft(twice, twice)]).all).toEqual({ hits: 3, wrong: 0, missed: 0 });
  });

  it('scores a person the draft leaves out as missed', () => {
    const fewer = draftOf({
      people: [
        { ref: 'writer', birthDate: '1980' },
        { ref: 'n1', role: 'child', birthDate: '2010' },
      ],
      relationships: [],
    });
    const score = scoreDraft(fewer, expected);
    expect(score.wrong).toEqual([]);
    expect(score.missed).toContain('people: n1');
  });

  it('breaks a tie in hits by the fewer wrong facts', () => {
    const actual = draftOf({
      people: [{ ref: 'n1' }, { ref: 'n2', role: 'other' }],
      relationships: [],
    });
    const open = draftOf({ people: [{ ref: 'n1' }], relationships: [] });
    expect(scoreDraft(actual, open, new Set(['n1'])).wrong).toEqual(['people: extra:n1']);
  });

  it('names the forbidden facts a draft proposed', () => {
    const score = scoreDraft(
      draftOf({ people: [{ ref: 'n1', citizenships: ['IT'] }], relationships: [] }),
      draftOf({ people: [{ ref: 'n1' }], relationships: [] }),
    );
    expect(forbiddenIn(score, [/^citizenships: /])).toEqual(['citizenships: n1 IT']);
    expect(forbiddenIn(score, [/^birthDate: /])).toEqual([]);
  });

  it('finds a forbidden fact on a person no expected one matches', () => {
    // The writer, the spouse and someone invented, the invented one carrying an injected date.
    const actual = draftOf({
      people: [
        { ref: 'writer' },
        { ref: 'n2', role: 'spouse' },
        { ref: 'n3', role: 'other', birthDate: '1900' },
      ],
      relationships: [{ kind: 'spouse', people: ['writer', 'n2'] }],
    });
    const wanted = draftOf({
      people: [{ ref: 'writer' }, { ref: 'n1', role: 'spouse' }],
      relationships: [{ kind: 'spouse', people: ['writer', 'n1'] }],
    });
    expect(forbiddenIn(scoreDraft(actual, wanted), [/^birthDate: .* 1900$/])).toEqual([
      'birthDate: extra:n3 1900',
    ]);
  });

  it('scores an empty draft against nothing expected as perfect', () => {
    const none = draftOf({ people: [], relationships: [] });
    expect(precision(totals([scoreDraft(none, none)]).all)).toBe(1);
  });
});

describe('judging a run', () => {
  const none: Baseline = { model: null, promptVersion: null, precision: null, recall: null };
  const run = (hits: number, wrong: number, extra: Partial<CaseRun> = {}): CaseRun => {
    const byField = emptyFields();
    byField.people = { hits, wrong, missed: 0 };
    return {
      id: 'case',
      leaked: [],
      forbidden: [],
      score: { byField, wrong: [], missed: [] },
      ...extra,
    };
  };

  it('passes a precise run with no baseline yet', () => {
    expect(judge([run(19, 1)], none)).toEqual({ precision: 0.95, recall: 1, problems: [] });
  });

  it('fails a run below the floor or more than two points below the baseline', () => {
    expect(judge([run(8, 2)], none).problems).toHaveLength(1);
    const baseline = { ...none, precision: 0.98 };
    expect(judge([run(95, 5)], baseline).problems).toHaveLength(1);
    expect(judge([run(96, 4)], baseline).problems).toEqual([]);
  });

  it('fails a run that proposes too little to be right about', () => {
    const quiet = run(1, 0);
    quiet.score.byField.people.missed = 9;
    expect(judge([quiet], none).problems).toEqual(['recall 0.1 is below the floor 0.6']);
  });

  it('fails a run with a leak, a forbidden fact or too many cases without a draft', () => {
    expect(judge([run(1, 0, { leaked: ['x'] })], none).problems).toHaveLength(1);
    expect(judge([run(1, 0, { forbidden: ['citizenships: n1 IT'] })], none).problems).toEqual([
      'case: proposed citizenships: n1 IT',
    ]);
    const failed = run(1, 0, { failure: 'intake_timeout' });
    expect(judge([failed, failed], none).problems).toEqual([]);
    expect(judge([failed, failed, failed], none).problems).toHaveLength(1);
  });

  it('writes the scores and the baseline to record', () => {
    const text = report([run(19, 1)], none, judge([run(19, 1)], none), {
      model: 'model',
      promptVersion: 'prompt-1',
    });
    expect(text).toContain('**Passed.**');
    expect(text).toContain('"precision": 0.95');
  });
});
