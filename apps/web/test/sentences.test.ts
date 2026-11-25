import { routes } from '@arca/api-contract/client';
import { createI18n } from '@arca/i18n';
import { describe, expect, it } from 'vitest';
import { sentenceText } from '../src/questions/sentences.js';

const names = new Map([
  ['a', 'Ana'],
  ['b', 'Bruno'],
  ['c', 'Lia'],
]);
const regions = new Intl.DisplayNames(['pt-BR'], { type: 'region' });
const languages = new Intl.DisplayNames(['pt-BR'], { type: 'language' });

const as = (sentence: Record<string, unknown>) =>
  routes.getCasePlayback.response.schema.shape.sentences.element.parse(sentence);
const ana = { about: ['a'], person: 'a' };

describe('wording the case summary in pt-BR (spec 0007, R5)', () => {
  it.each<[Record<string, unknown>, string]>([
    [
      { kind: 'profileHidden', ...ana },
      'Os dados pessoais de Ana não foram compartilhados com você.',
    ],
    [{ kind: 'financesHidden', ...ana }, 'As finanças de Ana não foram compartilhadas com você.'],
    [
      { kind: 'unanswered', question: 'birthDate', ...ana },
      'Ainda sem resposta: Quando Ana nasceu?',
    ],
    [
      { kind: 'born', ...ana, date: '1985-04', age: { min: 41, max: 41 } },
      'Nascimento de Ana: abril de 1985 (41 anos).',
    ],
    [
      { kind: 'born', ...ana, date: '2026', age: { min: 0, max: 0 } },
      'Nascimento de Ana: 2026 (menos de 1 ano).',
    ],
    [
      { kind: 'born', ...ana, date: '2025-11', age: { min: 0, max: 1 } },
      'Nascimento de Ana: novembro de 2025 (0 ou 1 ano).',
    ],
    [
      {
        kind: 'citizenship',
        ...ana,
        country: 'IT',
        basis: 'descent',
        acquired: '2019',
        lost: 'none',
      },
      'Cidadania de Ana: Itália, por descendência, desde 2019.',
    ],
    [
      { kind: 'citizenship', ...ana, country: 'PT', lost: '2020-03-01' },
      'Cidadania de Ana: Portugal, até 1 de março de 2020.',
    ],
    [{ kind: 'noCitizenship', ...ana }, 'Cidadania de Ana: nenhuma.'],
    [{ kind: 'residence', ...ana, country: 'BR' }, 'País onde Ana mora: Brasil.'],
    [{ kind: 'education', ...ana, level: 3 }, 'Estudos de Ana: Ensino médio.'],
    [{ kind: 'studying', ...ana, studying: true }, 'Ana está estudando agora.'],
    [{ kind: 'studying', ...ana, studying: false }, 'Ana não está estudando agora.'],
    [
      { kind: 'language', ...ana, language: 'pt', level: 'native' },
      'Idioma de Ana: português (Língua materna).',
    ],
    [{ kind: 'noLanguage', ...ana }, 'Idiomas de Ana: nenhum.'],
    [
      { kind: 'jobOffer', ...ana, country: 'PT', sector: 'J', temporary: true },
      'Oferta de emprego para Ana: Portugal, na área de Informação e comunicação, temporária.',
    ],
    [
      {
        kind: 'jobOffer',
        ...ana,
        country: 'PT',
        sector: 'Q',
        temporary: false,
        occupation: '2211',
        annualSalary: { amount: '48000', currency: 'EUR' },
        sponsored: true,
      },
      'Oferta de emprego para Ana: Portugal, na área de Saúde e assistência social, ocupação: Médicos clínicos gerais, salário de € 48.000,00 por ano, com patrocínio da empresa para o visto.',
    ],
    [
      { kind: 'jobOffer', ...ana, country: 'US', sector: 'J', temporary: false, sponsored: false },
      'Oferta de emprego para Ana: Estados Unidos, na área de Informação e comunicação, sem patrocínio da empresa para o visto.',
    ],
    [{ kind: 'noJobOffer', ...ana }, 'Ofertas de emprego para Ana: nenhuma.'],
    [
      {
        kind: 'workPeriod',
        ...ana,
        label: 'Cliente dos EUA',
        occupation: '2512',
        relation: 'contractor',
        fullTime: true,
        employerCountry: 'US',
        workplaceCountry: 'BR',
        start: '2022-03',
        end: 'none',
      },
      'Trabalho de Ana (Cliente dos EUA): Desenvolvedores de software, prestando serviço, em tempo integral, empresa ou cliente: Estados Unidos, local de trabalho: Brasil, começou em março de 2022, trabalho atual.',
    ],
    [
      {
        kind: 'workPeriod',
        ...ana,
        capacity: 'manager',
        fullTime: false,
        start: '2015',
        end: '2019-06',
      },
      'Trabalho de Ana: ocupação não informada, em cargo de gerência, em tempo parcial, de 2015 a junho de 2019.',
    ],
    [{ kind: 'noWorkPeriod', ...ana }, 'Trabalhos de Ana: nenhum anotado.'],
    [
      {
        kind: 'qualification',
        ...ana,
        level: 7,
        field: '0912',
        country: 'BR',
        completed: '2010-12',
      },
      'Formação de Ana em Medicina (Pós-graduação: especialização, MBA ou mestrado), país: Brasil, concluída em dezembro de 2010.',
    ],
    [
      { kind: 'qualification', ...ana, country: 'PT' },
      'Formação de Ana (nível não informado), país: Portugal.',
    ],
    [{ kind: 'noQualification', ...ana }, 'Formações de Ana: nenhuma.'],
    [
      { kind: 'registration', ...ana, country: 'BR', occupation: '2211', since: '2011-02' },
      'Registro profissional de Ana: Médicos clínicos gerais, país: Brasil, desde fevereiro de 2011.',
    ],
    [{ kind: 'registration', ...ana }, 'Registro profissional de Ana: ocupação não informada.'],
    [{ kind: 'noRegistration', ...ana }, 'Registros profissionais de Ana: nenhum.'],
    [
      {
        kind: 'residencePeriod',
        ...ana,
        country: 'PT',
        basis: 'temporary_residence',
        start: '2023-02',
        end: 'none',
      },
      'Residência de Ana: Portugal, com visto ou residência temporária, desde fevereiro de 2023 até hoje.',
    ],
    [
      {
        kind: 'residencePeriod',
        ...ana,
        country: 'BR',
        basis: 'citizen',
        start: '1990',
        end: '2023-01',
      },
      'Residência de Ana: Brasil, com cidadania, de 1990 a janeiro de 2023.',
    ],
    [
      { kind: 'residencePeriod', ...ana, country: 'US', end: 'none' },
      'Residência de Ana: Estados Unidos, até hoje.',
    ],
    [
      { kind: 'residencePeriod', ...ana, country: 'US', basis: 'other', end: '2009-12' },
      'Residência de Ana: Estados Unidos, em outra situação, até dezembro de 2009.',
    ],
    [
      { kind: 'residencePeriod', ...ana, country: 'PT', start: '2020' },
      'Residência de Ana: Portugal, começou em 2020.',
    ],
    [{ kind: 'noResidencePeriod', ...ana }, 'Países onde Ana morou: nenhum anotado.'],
    [
      { kind: 'immigrationEvent', ...ana, country: 'US', event: 'visa_refusal', date: '2018' },
      'Imigração de Ana: Visto negado, Estados Unidos, em 2018.',
    ],
    [
      { kind: 'noImmigrationEvent', ...ana },
      'Imigração de Ana: nenhum visto, residência ou problema.',
    ],
    [{ kind: 'dependsOn', ...ana, on: ['b', 'c'] }, 'Ana depende do dinheiro de Bruno e Lia.'],
    [{ kind: 'independent', ...ana }, 'Ana não depende do dinheiro de ninguém do caso.'],
    [
      { kind: 'recordedInFull', ...ana, marker: 'children' },
      'Todos os filhos de Ana estão anotados.',
    ],
    [{ kind: 'recordedInFull', ...ana, marker: 'assets' }, 'Todos os bens de Ana estão anotados.'],
    [
      {
        kind: 'income',
        ...ana,
        income: 'passive',
        monthly: { amount: '1200.5', currency: 'BRL' },
        sourceCountry: 'PT',
      },
      'Renda de Ana: R$ 1.200,50 por mês, de aluguel, aposentadoria ou rendimentos (Portugal).',
    ],
    [{ kind: 'noIncome', ...ana }, 'Renda de Ana: nenhuma.'],
    [
      {
        kind: 'couple',
        about: ['a', 'b'],
        couple: 'spouse',
        people: ['a', 'b'],
        start: '2010-05',
        end: 'none',
      },
      'Ana e Bruno são casados desde maio de 2010.',
    ],
    [
      {
        kind: 'couple',
        about: ['a', 'b'],
        couple: 'partner',
        people: ['a', 'b'],
        start: '2005',
        end: '2008',
      },
      'Ana e Bruno viveram em união estável de 2005 até 2008.',
    ],
    [
      {
        kind: 'parent',
        about: ['a', 'c'],
        parent: 'a',
        child: 'c',
        parentKind: 'adoptive',
        custody: 'shared',
        start: '2018',
        custodyStart: '2016',
      },
      'Ana é mãe ou pai de Lia desde 2018, filiação adotiva, guarda compartilhada desde 2016.',
    ],
    [
      { kind: 'parent', about: ['a', 'c'], parent: 'a', child: 'c', custodyStart: '2016-02' },
      'Ana é mãe ou pai de Lia, guarda desde fevereiro de 2016.',
    ],
    [
      {
        kind: 'asset',
        about: ['a', 'b'],
        asset: 'real_estate',
        value: { amount: '500000', currency: 'BRL' },
        valuedAt: '2026-01-10',
        owners: [
          { person: 'a', share: '0.5' },
          { person: 'b', share: '0.5' },
        ],
        liquid: false,
        sold: '2026-10',
      },
      'Imóvel de Ana (50%) e Bruno (50%): R$ 500.000,00 em 10 de janeiro de 2026, difícil de transformar em dinheiro, com venda em outubro de 2026.',
    ],
    [
      {
        kind: 'asset',
        about: ['a'],
        asset: 'business',
        value: { amount: '300000', currency: 'BRL' },
        valuedAt: '2026-06-30',
        owners: [{ person: 'a', share: '1' }],
        country: 'BR',
        operatingSince: '2018-05',
        employees: 0,
      },
      'Empresa ou participação de Ana (100%): R$ 300.000,00 em 30 de junho de 2026, sede: Brasil, funcionando desde maio de 2018, sem funcionários.',
    ],
    [
      {
        kind: 'asset',
        about: ['a'],
        asset: 'business',
        value: { amount: '300000', currency: 'BRL' },
        valuedAt: '2026-06-30',
        owners: [{ person: 'a', share: '1' }],
        country: 'BR',
        operatingSince: '2018-05',
        employees: 1,
      },
      'Empresa ou participação de Ana (100%): R$ 300.000,00 em 30 de junho de 2026, sede: Brasil, funcionando desde maio de 2018, 1 funcionário.',
    ],
    [
      {
        kind: 'asset',
        about: ['a'],
        asset: 'business',
        value: { amount: '300000', currency: 'BRL' },
        valuedAt: '2026-06-30',
        owners: [{ person: 'a', share: '1' }],
        country: 'BR',
        operatingSince: '2018-05',
        employees: 6,
      },
      'Empresa ou participação de Ana (100%): R$ 300.000,00 em 30 de junho de 2026, sede: Brasil, funcionando desde maio de 2018, 6 funcionários.',
    ],
    [
      {
        kind: 'workPeriod',
        ...ana,
        relation: 'owner',
        capacity: 'manager',
        start: '2019-03',
        end: 'none',
        atOwnBusiness: true,
      },
      'Trabalho de Ana: ocupação não informada, na própria empresa, em cargo de gerência, começou em março de 2019, trabalho atual, na empresa listada nos bens.',
    ],
  ])('words %j', async (sentence, text) => {
    const i18n = await createI18n();
    expect(
      sentenceText(
        {
          t: i18n.t,
          language: 'pt-BR',
          name: (id) => names.get(id) ?? '',
          country: (code) => regions.of(code) ?? code,
          languageName: (code) => languages.of(code) ?? code,
        },
        as(sentence),
      ),
    ).toBe(text);
  });
});
