import { describe, expect, it } from 'vitest';
import type { Acceptance } from '../../src/review-gate/acceptances.ts';
import type { Finding } from '../../src/review-gate/schema.ts';
import {
  failsGate,
  judgeGate,
  judgeReviewer,
  parseReviewerOutput,
} from '../../src/review-gate/verdict.ts';

const mustPass = { name: 'security-reviewer', mustPass: true };
const shouldPass = { name: 'standards-reviewer', mustPass: false };

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: 'medium',
    category: 'injection',
    file: 'apps/api/src/routes/guides.ts',
    line: 6,
    text: 'Builds SQL from the query string; use a parameter.',
    ...overrides,
  };
}

function output(findings: Finding[] = [], unassessed: { reason: string; note: string }[] = []) {
  return JSON.stringify({ findings, unassessed });
}

const acceptance: Acceptance = {
  pullRequest: 42,
  reviewer: 'security-reviewer',
  file: 'apps/api/src/routes/guides.ts',
  category: 'injection',
  reason: 'Read-only demo table.',
};

describe('reviewer output', () => {
  it.each([
    ['missing', undefined, 'missing'],
    ['empty', '', 'missing'],
    ['not JSON', 'PASS', 'invalid'],
    ['without unassessed', JSON.stringify({ findings: [] }), 'invalid'],
    [
      'with an unknown key',
      JSON.stringify({ findings: [], unassessed: [], verdict: 'PASS' }),
      'invalid',
    ],
    [
      'with an unknown category',
      output([finding({ category: 'sql' as Finding['category'] })]),
      'invalid',
    ],
    [
      'with an unknown severity',
      output([finding({ severity: 'blocker' as Finding['severity'] })]),
      'invalid',
    ],
    ['with an unknown unassessed reason', output([], [{ reason: 'skipped', note: '' }]), 'invalid'],
    ['with an empty finding text', output([finding({ text: '' })]), 'invalid'],
    ['with a fractional line', output([finding({ line: 1.5 })]), 'invalid'],
  ])('is %s', (_label, raw, expected) => {
    expect(parseReviewerOutput(raw)).toBe(expected);
  });

  it('accepts a valid output', () => {
    expect(parseReviewerOutput(output([finding()]))).toMatchObject({ findings: [finding()] });
  });
});

describe('reviewer verdict and gate (spec 0001, R10)', () => {
  const judge = (
    reviewer: { name: string; mustPass: boolean },
    raw: string | undefined,
    rows: Acceptance[] = [],
  ) => judgeReviewer(reviewer, raw, rows, 42);

  it.each(['critical', 'high'] as const)('a %s finding fails, from any reviewer', (severity) => {
    for (const reviewer of [mustPass, shouldPass]) {
      const judgement = judge(reviewer, output([finding({ severity })]));
      expect(judgement.outcome).toBe('block');
      expect(failsGate(judgement)).toBe(true);
    }
  });

  it('a medium finding from a must-pass reviewer fails', () => {
    expect(failsGate(judge(mustPass, output([finding()])))).toBe(true);
  });

  it('a medium finding passes when a row matches pull request, reviewer, file and category', () => {
    const judgement = judge(mustPass, output([finding()]), [acceptance]);
    expect(judgement.outcome).toBe('pass');
    expect(judgement.accepted).toHaveLength(1);
    expect(failsGate(judgement)).toBe(false);
  });

  it.each([
    ['pull request', { pullRequest: 41 }],
    ['reviewer', { reviewer: 'correctness-reviewer' }],
    ['file', { file: 'apps/api/src/routes/other.ts' }],
    ['category', { category: 'access-control' }],
  ])('a row for another %s accepts nothing', (_label, change) => {
    expect(failsGate(judge(mustPass, output([finding()]), [{ ...acceptance, ...change }]))).toBe(
      true,
    );
  });

  it('an acceptance row never covers a high finding', () => {
    expect(failsGate(judge(mustPass, output([finding({ severity: 'high' })]), [acceptance]))).toBe(
      true,
    );
  });

  it('a medium finding from a should-pass reviewer blocks that reviewer but not the gate', () => {
    const judgement = judge(shouldPass, output([finding({ category: 'i18n-violation' })]));
    expect(judgement.outcome).toBe('block');
    expect(failsGate(judgement)).toBe(false);
  });

  it.each(['missing_context', 'other'])(
    'an unassessed %s from a must-pass reviewer fails',
    (reason) => {
      expect(failsGate(judge(mustPass, output([], [{ reason, note: 'n' }])))).toBe(true);
    },
  );

  it('tests_not_run does not fail, since the required test checks run them', () => {
    expect(failsGate(judge(mustPass, output([], [{ reason: 'tests_not_run', note: 'n' }])))).toBe(
      false,
    );
  });

  it('an unassessed entry from a should-pass reviewer does not fail the gate', () => {
    expect(
      failsGate(judge(shouldPass, output([], [{ reason: 'missing_context', note: 'n' }]))),
    ).toBe(false);
  });

  it('a low finding passes', () => {
    expect(failsGate(judge(mustPass, output([finding({ severity: 'low' })])))).toBe(false);
  });

  it.each([
    ['missing', undefined],
    ['invalid', '{"findings": []}'],
  ])('%s output fails the gate for every reviewer', (_label, raw) => {
    expect(failsGate(judge(mustPass, raw))).toBe(true);
    expect(failsGate(judge(shouldPass, raw))).toBe(true);
  });

  it('the gate passes only when no reviewer fails it and the canary passed', () => {
    const clean = [judge(mustPass, output()), judge(shouldPass, output())];
    expect(judgeGate(clean, { state: 'passed' })).toEqual({ pass: true, failing: [] });
    expect(judgeGate(clean, { state: 'missing', detail: 'none' }).pass).toBe(false);
    expect(judgeGate(clean, { state: 'failed', detail: 'failed' }).pass).toBe(false);
    expect(judgeGate([...clean, judge(mustPass, undefined)], { state: 'passed' })).toEqual({
      pass: false,
      failing: ['security-reviewer'],
    });
  });
});
