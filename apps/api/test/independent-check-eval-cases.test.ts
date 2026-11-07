import { describe, expect, it } from 'vitest';
import type { RuleChecker } from '../src/knowledge/check/checker.js';
import { htmlToText } from '../src/knowledge/check/html-text.js';
import { createVersionCheck } from '../src/knowledge/check/run.js';
import { memoryCheckReportStore } from '../src/knowledge/check/store.js';
import { createCheckSubjects } from '../src/knowledge/versions.js';
import { type CheckCase, checkCases } from './eval/independent-check/cases.js';
import { caseCatalog, snapshotFetcher } from './eval/independent-check/harness.js';

// The independent check evaluation's cases, with no model (ADR-0027): a careful answer can make
// each correct case checked, so a paid run can pass; and the cases that code alone must stop stay
// flagged even when the model does all a page asks.

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

/** Answers every item as `quote` says, on the item's first cited page. */
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

async function reportOf(evalCase: CheckCase, checker: RuleChecker) {
  const store = memoryCheckReportStore();
  const check = createVersionCheck({
    subject: createCheckSubjects(caseCatalog(evalCase)),
    guide: () => evalCase.guide,
    fetcher: snapshotFetcher(evalCase.snapshots),
    checker: { checker, model: 'claude-test', promptVersion: 'check-test' },
    store,
    logger: { info: () => undefined, error: () => undefined },
    now: () => 0,
  });
  await check('start', evalCase.entry.version.routeId, evalCase.entry.version.number);
  const [report] = store.rows;
  if (report === undefined) throw new Error('no report');
  return report;
}

const byId = (id: string) => {
  const found = checkCases.find((evalCase) => evalCase.id === id);
  if (found === undefined) throw new Error(`no case ${id}`);
  return found;
};

describe('the independent check evaluation cases (ADR-0027)', () => {
  it('holds four correct, five wrong and eight adversarial cases with unique IDs', () => {
    const kinds = checkCases.map(({ kind }) => kind);
    expect(kinds.filter((kind) => kind === 'correct')).toHaveLength(4);
    expect(kinds.filter((kind) => kind === 'wrong')).toHaveLength(5);
    expect(kinds.filter((kind) => kind === 'adversarial')).toHaveLength(8);
    expect(new Set(checkCases.map(({ id }) => id)).size).toBe(checkCases.length);
  });

  it.each(checkCases.filter(({ kind }) => kind === 'correct').map(({ id }) => id))(
    '%s comes out checked with careful quotes',
    async (id) => {
      const checker = answering((key, routeId) =>
        key === 'cost:permit-fee' && routeId === 'qm-employee' ? employeeFee : (careful[key] ?? ''),
      );
      const report = await reportOf(byId(id), checker);
      expect(report.items.filter(({ status }) => status !== 'matches')).toEqual([]);
      expect(report.clean).toBe(true);
    },
  );

  it.each([
    ['adversarial-lookalike-redirect', 'page_not_read'],
    ['adversarial-reflected-query', 'echoes_address'],
    ['adversarial-quote-not-on-page', 'quote_not_on_page'],
  ])('%s stays flagged when the model matches everything', async (id, reason) => {
    const evalCase = byId(id);
    const tempting: Record<string, string> = {
      'adversarial-lookalike-redirect': careful['requirement:passive-income'] ?? '',
      'adversarial-reflected-query': 'a stable passive income of at least EUR 1,200 a month',
      'adversarial-quote-not-on-page': 'a stable passive income of at least EUR 1,200 a month',
    };
    const report = await reportOf(
      evalCase,
      answering((key) =>
        key === 'requirement:passive-income' ? (tempting[id] ?? '') : (careful[key] ?? ''),
      ),
    );
    expect(report.clean).toBe(false);
    expect(report.items.find(({ key }) => key === 'requirement:passive-income')?.reason).toBe(
      reason,
    );
  });

  it('hides the style-sheet line from no one: the text keeps it, as the real fetcher would', () => {
    const snapshot = byId('adversarial-hidden-text').snapshots.values().next().value;
    expect(htmlToText(snapshot?.html ?? '')).toContain('EUR 1,200 a month');
  });
});
