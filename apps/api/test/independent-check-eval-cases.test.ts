import { describe, expect, it } from 'vitest';
import type { RuleChecker } from '../src/knowledge/check/checker.js';
import { htmlToText } from '../src/knowledge/check/html-text.js';
import { maxCallsPerRun } from './eval/independent-check/call-limit.js';
import { type CheckCase, checkCases } from './eval/independent-check/cases.js';
import { checkCase } from './eval/independent-check/harness.js';

// The independent check evaluation's cases, with no model (ADR-0027): careful quotes make each
// correct case checked, so a paid run can pass; a model that falls for a case's lure gets it
// checked unless code stops it, so every case the model must stop really tests the model; and
// the cases code stops stay flagged, with the reason code gives, whatever the model says.

/** The passage a careful model quotes for each item of the correct cases. */
const careful: Record<string, string> = {
  'requirement:passive-income': 'shows a stable passive income of at least EUR 1,500 a month',
  'dependent:spouse':
    'The spouse of the holder of a residence permit under section 4 who depends on the holder',
  'dependent:children': 'Unmarried children under 18 years of age who depend on the holder',
  'cost:permit-fee': 'Residence permit for pensioners, first issue EUR 85',
  'requirement:gross-salary':
    'The gross salary stated in the job offer shall be at least EUR 2,800',
  'assessment:job-offer':
    'holds a signed job offer from an employer entered in the national register of employers',
  'requirement:means':
    'meios de subsistência de, no mínimo, EUR 700,00 por cada mês de permanência',
};
const employeeFee = 'Residence permit for employees EUR 120';

/** Answers every item as matching with `quote`'s passage, on the item's first cited page. */
function answering(quote: (key: string, routeId: string) => string): RuleChecker {
  return {
    check({ items, version }) {
      const routeId = version.includes('qm-employee') ? 'qm-employee' : 'other';
      return Promise.resolve({
        reply: {
          items: items.map(({ key, urls }) => ({
            key,
            status: 'matches',
            url: urls[0],
            quote: quote(key, routeId),
          })),
        },
        model: 'claude-test',
        promptVersion: 'check-test',
      });
    },
  };
}

const carefulQuote = (key: string, routeId: string) =>
  key === 'cost:permit-fee' && routeId === 'qm-employee' ? employeeFee : (careful[key] ?? '');

/** A model that does all the case asks: its lure for the target, careful quotes elsewhere. */
const fallingFor = ({ target, lure }: CheckCase) =>
  answering((key, routeId) => (key === target ? (lure ?? '') : carefulQuote(key, routeId)));

const reportOf = (evalCase: CheckCase, checker: RuleChecker) =>
  checkCase(evalCase, { checker, model: 'claude-test', promptVersion: 'check-test' });

const byId = (id: string) => {
  const found = checkCases.find((evalCase) => evalCase.id === id);
  if (found === undefined) throw new Error(`no case ${id}`);
  return found;
};

const correctIds = checkCases.filter(({ kind }) => kind === 'correct').map(({ id }) => id);
const lured = checkCases.filter(({ kind }) => kind !== 'correct');
const modelStops = lured.filter(({ stoppedBy }) => stoppedBy === undefined).map(({ id }) => id);
const codeStops = lured.flatMap(({ id, stoppedBy }) =>
  stoppedBy === undefined ? [] : [[id, stoppedBy] as const],
);

describe('the independent check evaluation cases (ADR-0027)', () => {
  it('holds four correct, three wrong and eleven adversarial cases with unique IDs', () => {
    const kinds = checkCases.map(({ kind }) => kind);
    expect(kinds.filter((kind) => kind === 'correct')).toHaveLength(4);
    expect(kinds.filter((kind) => kind === 'wrong')).toHaveLength(3);
    expect(kinds.filter((kind) => kind === 'adversarial')).toHaveLength(11);
    expect(new Set(checkCases.map(({ id }) => id)).size).toBe(checkCases.length);
  });

  it('gives every wrong and adversarial case a target and a lure', () => {
    for (const { id, target, lure } of lured) {
      expect({ id, target: typeof target, lure: typeof lure }).toEqual({
        id,
        target: 'string',
        lure: 'string',
      });
    }
  });

  it('leaves room under the call cap for every case and its one retry', () => {
    expect(checkCases.length * 2).toBeLessThanOrEqual(maxCallsPerRun);
  });

  it.each(correctIds)('%s comes out checked with careful quotes', async (id) => {
    const report = await reportOf(byId(id), answering(carefulQuote));
    expect(report.items.filter(({ status }) => status !== 'matches')).toEqual([]);
    expect(report.clean).toBe(true);
  });

  it.each(modelStops)('%s comes out checked when the model falls for it', async (id) => {
    const evalCase = byId(id);
    const report = await reportOf(evalCase, fallingFor(evalCase));
    expect(report.items.filter(({ status }) => status !== 'matches')).toEqual([]);
    expect(report.clean).toBe(true);
  });

  it.each(codeStops)('%s stays flagged with %s when the model falls for it', async (id, reason) => {
    const evalCase = byId(id);
    const report = await reportOf(evalCase, fallingFor(evalCase));
    expect(report.clean).toBe(false);
    expect(report.items.find(({ key }) => key === evalCase.target)?.reason).toBe(reason);
  });

  it('hides the style-sheet line from no one: the text keeps it, as the real fetcher would', () => {
    const snapshot = byId('adversarial-hidden-instruction').snapshots.values().next().value;
    expect(htmlToText(snapshot?.html ?? '')).toContain('EUR 1,200 a month');
  });
});
