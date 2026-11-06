import { describe, expect, it } from 'vitest';
import { maskIntakeText } from '../../src/index.js';

/** Synthetic names and numbers only. */
const people = [
  { id: 'a', displayName: 'Joana da Silveira' },
  { id: 'b', displayName: 'Otávio Silveira' },
  { id: 'c', displayName: 'Ana' },
  { id: 'd', displayName: 'Zé' },
  { id: 'e', displayName: 'Lu Prates' },
  { id: 'f', displayName: 'Maria J Prado' },
];

describe('maskIntakeText (spec 0008, R2)', () => {
  it.each([
    ['a full name with a particle', 'Eu sou a Joana da Silveira.', 'Eu sou a [P1].'],
    ['a first name alone', 'A joana nasceu em 1990.', 'A [P1] nasceu em 1990.'],
    ['accents and case ignored', 'OTAVIO é meu marido.', '[P2] é meu marido.'],
    ['an accented spelling of a plain name', 'Ána tem 5 anos.', '[P3] tem 5 anos.'],
    ['a surname several people share', 'Os Silveira moram aqui.', 'Os [nome] moram aqui.'],
    ['a full name that holds a shared surname', 'Otávio Silveira chegou.', '[P2] chegou.'],
    ['a name inside another word', 'Mariana e Anabela vieram.', 'Mariana e Anabela vieram.'],
    ['a particle alone', 'Ela é da Bahia.', 'Ela é da Bahia.'],
    ['a short display name, whole', 'Zé chegou.', '[P4] chegou.'],
    ['a two-letter word of a longer name', 'Lu veio.', '[P5] veio.'],
    ['a single letter of a longer name', 'Maria J Prado e J', '[P6] e J'],
    ['a full name across a line break', 'Joana\nda Silveira', '[P1]'],
  ])('%s', (_, text, masked) => {
    expect(maskIntakeText(text, people).masked).toBe(masked);
  });

  it.each([
    ['a CPF', 'Meu CPF é 123.456.789-09.', 'Meu CPF é [número].'],
    ['a CPF without punctuation', 'cpf 12345678909', 'cpf [número]'],
    ['a passport number', 'passaporte FX123456', 'passaporte [número]'],
    ['an Italian codice fiscale', 'codice RSSMRA80A01H501U', 'codice [número]'],
    ['an IBAN', 'IBAN BR15 0000 0000 0000 0000 0000 000P 1', 'IBAN BR[número]P 1'],
    ['an IBAN without spaces', 'IT60X0542811101000000123456', '[número]'],
    ['a mobile phone', 'ligue (11) 98765-4321', 'ligue (11) [número]'],
    ['a phone with a country code', 'tel +55 11 98765 4321', 'tel [número]'],
    ['an e-mail address', 'escreva para joana.silveira@exemplo.com.br', 'escreva para [e-mail]'],
    ['a year', 'nasceu em 1921', 'nasceu em 1921'],
    ['two years', 'filhos de 2014 e 2019', 'filhos de 2014 e 2019'],
    ['a date with slashes', 'em 3/3/1950', 'em 3/3/1950'],
    ['a date with dots', 'em 03.03.1950', 'em 03.03.1950'],
    ['an ISO date', 'em 1950-03-03', 'em 1950-03-03'],
    ['a month and year', 'em 03/1950', 'em 03/1950'],
    ['a date in words', 'em 3 de março de 1950', 'em 3 de março de 1950'],
    ['a short number', 'temos 2 filhos e 1234 reais', 'temos 2 filhos e 1234 reais'],
    ['a short code', 'no ap 12B', 'no ap 12B'],
    ['a phone with an en dash', 'tel 3456–7890', 'tel [número]'],
    ['a phone with a non-breaking space', 'tel 3456\u00a07890', 'tel [número]'],
    ['a phone with a spaced dash', 'tel 9876 - 5432', 'tel [número]'],
    ['a CPF with commas', 'cpf 123,456,789-09', 'cpf [número]'],
    ['full-width digits', 'tel ９８７６５４３２１', 'tel [número]'],
    ['a bank account shaped like a month', 'conta 1234-56', 'conta [número]'],
    ['an account shaped like a month first', 'conta 12-3456', 'conta [número]'],
    ['a branch with a check digit', 'agência 1234-5', 'agência [número]'],
    ['a document shaped like a date', 'doc 12.34.5678', 'doc [número]'],
    ['an impossible date', 'num 99/99/9999', 'num [número]'],
    ['a date-shaped part of a longer number', 'n 12.3456 7890', 'n [número]'],
    ['a year range', 'filhos de 2014/2019', 'filhos de 2014/2019'],
    ['a year, a comma and a count', 'casamos em 2005, 2 filhos', 'casamos em 2005, 2 filhos'],
    ['a year, a dash and a count', 'nasceu em 1985 - 3 filhos', 'nasceu em 1985 - 3 filhos'],
    ['a year and a span', '1985, 12 anos depois', '1985, 12 anos depois'],
    ['two dates in a list', 'filhos em 12/03/2014, 05/07/2019', 'filhos em 12/03/2014, 05/07/2019'],
    ['a date then a CPF', 'em 12/03/2014, cpf 123.456.789-09', 'em 12/03/2014, cpf [número]'],
    [
      'a date and a CPF with only a space, masked together',
      '12/03/2014 123.456.789-09',
      '[número]',
    ],
    ['years joined by a hyphen, shaped like a phone', 'tel 2034-1999', 'tel [número]'],
    ['a phone with wide spaces around a dash', 'tel 3456  -  7890', 'tel [número]'],
    ['a phone right after a letter', 'a1234-5678', 'a[número]'],
    ['a phone with a year-shaped group', 'tel 3456 2010', 'tel [número]'],
    [
      'a phone with an area code and a year-shaped group',
      'tel (11) 3456 2010',
      'tel (11) [número]',
    ],
    ['a phone with a spaced dash and a year-shaped group', 'tel 3456 - 2010', 'tel [número]'],
    ['a ten-digit phone with a year-shaped group', 'tel 11 2034 5678', 'tel 11 [número]'],
    ['a phone with a country code', 'tel +55 11 2034 5678', 'tel +55 11 [número]'],
    ['a card with a year-shaped group', 'cartão 4111 2019 1111 1111', 'cartão [número]'],
    ['an account then a year', 'conta 12345 2019', 'conta [número]'],
    ['years in a list', 'em 2014, 2016, 2019', 'em 2014, 2016, 2019'],
    ['an ISO date with a time', 'em 1950-03-03T10:00', 'em 1950-03-03T10:00'],
  ])('%s', (_, text, masked) => {
    expect(maskIntakeText(text, people).masked).toBe(masked);
  });

  it('turns a placeholder the member typed into plain text', () => {
    const { masked, placeholders } = maskIntakeText('Sou o [P2] e [nome]', people);
    expect(masked).toBe('Sou o (P2) e (nome)');
    expect(placeholders.size).toBe(0);
  });

  it('folds letters that do not decompose', () => {
    const named = [{ id: 'x', displayName: 'Łukasz Øster' }];
    expect(maskIntakeText('Lukasz Oster', named).masked).toBe('[P1]');
  });

  it.each([
    ['repeated e-mail characters', '%'.repeat(4000)],
    ['repeated digits and dots', '1.'.repeat(2000)],
    ['repeated spaces after a digit', `1${' '.repeat(3999)}`],
    ['repeated letters and digits', 'a1'.repeat(2000)],
  ])(
    'masks %s within the test timeout, so the patterns do not backtrack',
    (_, text) => {
      expect(maskIntakeText(text, people).masked.length).toBeLessThanOrEqual(text.length);
    },
    1000,
  );

  it('masks an e-mail inside punctuation', () => {
    expect(maskIntakeText('(joana@exemplo.com),', people).masked).toBe('([e-mail]),');
  });

  it('maps only the placeholders the masked text holds back to their people', () => {
    const { placeholders } = maskIntakeText('Joana e Ana', people);
    expect([...placeholders]).toEqual([
      ['[P1]', 'a'],
      ['[P3]', 'c'],
    ]);
  });

  it('masks an e-mail before the name inside it', () => {
    expect(maskIntakeText('joana@exemplo.com', people).masked).toBe('[e-mail]');
  });
});
