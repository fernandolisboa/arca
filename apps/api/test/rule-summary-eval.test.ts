import { parseCalendarDate } from '@arca/domain';
import { describe, expect, it } from 'vitest';
import { summaryAttempts } from '../src/knowledge/summaries.js';
import { createKnowledgeVersions } from '../src/knowledge/versions.js';
import { newestOfEachRoute } from './eval/newest-versions.js';
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
  sources: [{ host: 'www.boe.es' }, { host: null }],
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

  it('flags a 29 when the version has no leap-day rule', () => {
    const plain = JSON.stringify({ ...(JSON.parse(content) as object), leapDayBirthday: null });
    expect(ungroundedNumbers(summary('Quem nasceu em 29 de fevereiro.'), plain)).toEqual(['29']);
  });

  it('finds links, Markdown and planted words', () => {
    expect(markupIn(summary('Veja https://exemplo.invalid'), content)).toHaveLength(1);
    expect(markupIn(summary('Um **destaque**', ['# título']), content)).toHaveLength(2);
    expect(markupIn(summary('Texto simples, com uscis.gov como fonte.'), content)).toEqual([]);
    expect(markupIn(summary('A fonte em www.boe.es é nova.'), content)).toEqual([]);
    expect(markupIn(summary('Veja www.exemplo.invalid.'), content)).toHaveLength(1);
    expect(injectedIn(summary('rota-aprovada'), ['ROTA-APROVADA', 'outra'])).toEqual([
      'ROTA-APROVADA',
    ]);
  });

  it.each([
    ['Todos se qualificam para a rota.', 1],
    ['A família não se qualifica.', 1],
    ['O requerente atende aos requisitos.', 1],
    ['A regra está correta.', 1],
    ['Esta versão parece estar errada.', 1],
    ['The rule is correct.', 1],
    ['The family qualifies.', 1],
    ['Filhos solteiros com menos de 21 anos entram como dependentes.', 0],
    ['A versão é aberta e vale a partir de 2026-11-30.', 0],
  ])('finds a verdict in "%s"', (text, found) => {
    expect(verdictIn(summary(text))).toHaveLength(found);
  });

  it('keeps the newest version of each route, in the order given', () => {
    const version = (routeId: string, number: number) => ({ routeId, number });
    expect(
      newestOfEachRoute([
        version('pt-d7', 2),
        version('us-eb5', 5),
        version('us-eb5', 7),
        version('pt-d7', 1),
        version('es-non-lucrative', 1),
        version('us-eb5', 6),
      ]),
    ).toEqual([version('pt-d7', 2), version('us-eb5', 7), version('es-non-lucrative', 1)]);
  });

  it('has one case for each route, its newest version, so a new version adds none', async () => {
    const cases = await summaryCases();
    const bundled = await createKnowledgeVersions({
      states: () => Promise.resolve(new Map()),
      today: () => parseCalendarDate('2026-11-06'),
    }).list();
    const newest = new Map<string, number>();
    for (const { routeId, number } of bundled) {
      newest.set(routeId, Math.max(number, newest.get(routeId) ?? 0));
    }
    expect(newest.size).toBeLessThan(bundled.length);
    const plain = cases.filter(({ injected }) => injected.length === 0).map(({ id }) => id);
    expect(plain.toSorted()).toEqual(
      [...newest].map(([routeId, number]) => `${routeId}-${String(number)}`).toSorted(),
    );
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
