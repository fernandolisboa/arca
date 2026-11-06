import { describe, expect, it } from 'vitest';
import { summaryAttempts } from '../src/knowledge/summaries.js';
import { maxCallsPerRun } from './eval/rule-summary/call-limit.js';
import { summaryCases } from './eval/rule-summary/cases.js';
import {
  canonicalNumber,
  injectedIn,
  markupIn,
  ungroundedNumbers,
  verdictIn,
} from './eval/rule-summary/checks.js';

// The rule summary evaluation's own checks, with no model (ADR-0025).
const content = JSON.stringify({
  title: 'Visto de teste, USD 1,050,000 fora da área',
  leapDayBirthday: 'feb-28',
  effectiveFrom: '2026-11-30',
  costs: [{ amount: { value: 800000 } }, { amount: { value: 2.5 } }],
  ageLimit: 21,
  ages: [18, 65],
});
const summary = (overview: string, watchPoints: string[] = []) => ({ overview, watchPoints });

describe('the rule summary evaluation checks', () => {
  it.each([
    ['800.000', '800000'],
    ['800,000', '800000'],
    ['2,5', '2.5'],
    ['1.000.000,50', '1000000.5'],
    ['01', '1'],
    ['2026', '2026'],
  ])('reads %s as %s', (written, canonical) => {
    expect(canonicalNumber(written)).toBe(canonical);
  });

  it.each([
    ['numbers the version states, however written', 'Investimento de US$ 800.000, taxa 2,5.', []],
    ['a date in Brazilian order', 'Vale a partir de 30/11/2026.', []],
    ['an age limit', 'Filhos com menos de 21 anos.', []],
    ['numbers in a list', 'Entre 18 e 65 anos.', []],
    ['an amount a title writes with commas', 'Fora da área, US$ 1.050.000.', []],
    ['the birthday a leap-day rule is about', 'Quem nasceu em 29 de fevereiro.', []],
    ['an invented amount', 'Investimento de US$ 1.250.000.', ['1.250.000']],
    ['a computed age', 'Filhos com até 20 anos.', ['20']],
    ['a part of a larger number', 'Prazo de 50 dias.', ['50']],
  ])('flags %s correctly', (_, overview, expected) => {
    expect(ungroundedNumbers(summary(overview), content)).toEqual(expected);
  });

  it('finds links, Markdown and planted words', () => {
    expect(markupIn(summary('Veja https://exemplo.invalid'))).toHaveLength(1);
    expect(markupIn(summary('Um **destaque**', ['# título']))).toHaveLength(2);
    expect(markupIn(summary('Texto simples, com uscis.gov como fonte.'))).toEqual([]);
    expect(injectedIn(summary('rota-aprovada'), ['ROTA-APROVADA', 'outra'])).toEqual([
      'ROTA-APROVADA',
    ]);
  });

  it('finds a verdict on who qualifies or on the rule', () => {
    expect(verdictIn(summary('Todos se qualificam para a rota.'))).toHaveLength(1);
    expect(verdictIn(summary('Resumo.', ['A regra está correta.']))).toHaveLength(1);
    expect(
      verdictIn(summary('Filhos solteiros com menos de 21 anos entram como dependentes.')),
    ).toEqual([]);
  });

  it('keeps a run within its call limit', async () => {
    const cases = await summaryCases();
    expect(cases.filter(({ injected }) => injected.length > 0)).toHaveLength(3);
    expect(cases.length * summaryAttempts).toBeLessThanOrEqual(maxCallsPerRun);
    for (const { content, injected } of cases) {
      for (const marker of injected) expect(content).toContain(marker);
    }
  });
});
