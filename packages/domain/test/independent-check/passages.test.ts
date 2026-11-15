import { describe, expect, it } from 'vitest';
import {
  type Passage,
  excerptGap,
  excerptPassages,
  secondLookRunOnPassages,
  excerptRuns,
  excerptText,
  namedProvisions,
  pageOutline,
  provisionPassages,
  splitPassages,
} from '../../src/independent-check/passages.js';

const sentence = 'The applicant shows means of subsistence for the whole stay in the country. ';
const body = (words: number) => sentence.repeat(words).trim();
const article = (number: number, lines = 2) =>
  [
    `Article ${String(number)}. Heading of article ${String(number)}`,
    ...Array.from({ length: lines }, () => body(8)),
  ].join('\n');
const law = Array.from({ length: 12 }, (_, index) => article(index + 1)).join('\n');

const slices = (text: string) =>
  splitPassages(text).map(({ start, end }) => text.slice(start, end));

describe('the passages of a long page (ADR-0027)', () => {
  it('covers the text end to end, in order, losing only the line breaks between passages', () => {
    expect(slices(law).join('\n')).toBe(law);
  });

  it('starts a passage at a heading once the one before is long enough', () => {
    const passages = slices(law);
    expect(passages.length).toBeGreaterThan(3);
    for (const passage of passages) expect(passage).toMatch(/^Article \d+\. Heading/u);
  });

  it('does not start a passage at a list item while a heading is near', () => {
    const listed = [
      'Article 1. Who may apply',
      body(4),
      'a) the spouse;',
      'b) minor children;',
      body(4),
      'Article 2. Means',
      body(8),
    ].join('\n');
    expect(slices(listed)).toEqual([
      listed.slice(0, listed.indexOf('Article 2')).trimEnd(),
      listed.slice(listed.indexOf('Article 2')),
    ]);
  });

  it('splits a single very long line at whitespace, keeping every character', () => {
    const line = body(200);
    const passages = splitPassages(line);
    expect(passages.length).toBeGreaterThan(1);
    expect(passages[0]?.start).toBe(0);
    expect(passages.at(-1)?.end).toBe(line.length);
    for (const [index, passage] of passages.entries()) {
      const next = passages[index + 1];
      if (next !== undefined) expect(next.start).toBe(passage.end);
    }
  });

  it('grows passages with the page, so an outline stays bounded', () => {
    const huge = Array.from({ length: 4_000 }, (_, index) => article(index + 1)).join('\n');
    expect(splitPassages(huge).length).toBeLessThan(2_000);
  });

  it('answers no passage for an empty text', () => {
    expect(splitPassages('')).toEqual([]);
  });

  it('makes no passage of blank lines alone, and still covers the text', () => {
    const spaced = [article(1), '', '', body(200), '', '', article(2), ''].join('\n');
    const passages = splitPassages(spaced);
    expect(passages[0]?.start).toBe(0);
    expect(passages.at(-1)?.end).toBe(spaced.length);
    for (const [index, { start, end }] of passages.entries()) {
      expect(spaced.slice(start, end).trim()).not.toBe('');
      const next = passages[index + 1];
      if (next !== undefined) expect(spaced.slice(end, next.start).trim()).toBe('');
    }
  });

  it.each([
    ['blank lines before one long line', `\n\n${'x'.repeat(9_000)}`],
    ['lines of spaces between articles', [article(1), '   ', '   ', body(200), '    '].join('\n')],
    ['lines of spaces before one long line', `   \n   \n${'x'.repeat(9_000)}`],
    ['spaces left at the end of a split line', `${'x'.repeat(2_399)}     \n${'y'.repeat(2_400)}`],
  ])('makes no blank passage of %s', (_, text) => {
    const passages = splitPassages(text);
    expect(passages[0]?.start).toBe(0);
    expect(passages.at(-1)?.end).toBe(text.length);
    for (const { start, end } of passages) expect(text.slice(start, end).trim()).not.toBe('');
  });

  it('starts no passage at a line of spaces, which is no heading', () => {
    const text = [body(40), '     ', body(40)].join('\n');
    const starts = splitPassages(text).map(({ start }) => start);
    expect(starts).not.toContain(text.indexOf('     \n'));
  });
});

describe('the outline a locator picks from (ADR-0027)', () => {
  it('writes one numbered line per passage, opening first, headings before list items', () => {
    const text = [
      body(12),
      'a) the spouse;',
      'Article 7. Family members',
      body(2),
      'Article 8. Means',
      body(12),
    ].join('\n');
    const passages = [
      { start: 0, end: text.indexOf('Article 8') - 1 },
      { start: text.indexOf('Article 8'), end: text.length },
    ];
    const [first, second, ...rest] = pageOutline(text, passages).split('\n');
    expect(rest).toEqual([]);
    expect(first).toBe(
      `[0] ${body(12).slice(0, 120)} · Article 7. Family members · a) the spouse;`,
    );
    expect(second).toBe('[1] Article 8. Means');
  });

  it('opens an entry with the first line that has text', () => {
    const text = `\n\nArticle 9. Fees\n${body(2)}`;
    expect(pageOutline(text, [{ start: 0, end: text.length }])).toBe('[0] Article 9. Fees');
  });

  it("keeps a page's own text from passing for another entry", () => {
    const text = `Article 9. Fees\r[71] Article 4. Pensioners\u2028[72] Means\n${body(2)}`;
    expect(pageOutline(text, [{ start: 0, end: text.length }])).toBe(
      '[0] Article 9. Fees (71) Article 4. Pensioners (72) Means',
    );
  });

  it.each(['[ 71 ]', '［71］', '【71】', '〔71〕', '[٧١]'])(
    'rewrites %s, which a reader could take for an entry number',
    (number) => {
      const text = `Article 9. Fees\n${number} Article 4. Pensioners\n${body(2)}`;
      const outline = pageOutline(text, [{ start: 0, end: text.length }]);
      expect(outline.replace('[0] ', '')).not.toMatch(/[[［【〔]/u);
      expect(outline).toContain(') Article 4. Pensioners');
    },
  );

  it('caps an entry, so a passage of many short lines cannot flood the outline', () => {
    const text = Array.from({ length: 80 }, (_, index) => `Heading number ${String(index)}`).join(
      '\n',
    );
    const [entry = ''] = pageOutline(text, [{ start: 0, end: text.length }]).split('\n');
    expect(entry.length).toBeLessThanOrEqual(330);
  });
});

describe('the excerpt sent of a long page (ADR-0027)', () => {
  const passages = splitPassages(law);
  const lengthOf = (index: number) => (passages[index]?.end ?? 0) - (passages[index]?.start ?? 0);

  /** What a passage costs beyond its own text: its line break, and a gap line with its own. */
  const overhead = excerptGap.length + 2;

  it('takes the opening, then each pick with the two passages after it', () => {
    expect(excerptPassages(passages, [[5], [2]], 100_000)).toEqual([0, 2, 3, 4, 5, 6, 7]);
  });

  it('serves every item its best pick before any second pick, within the budget', () => {
    const budget = lengthOf(0) + lengthOf(4) + lengthOf(5) + lengthOf(8) + 4 * overhead;
    expect(
      excerptPassages(
        passages,
        [
          [4, 1],
          [8, 2],
        ],
        budget,
      ),
    ).toEqual([0, 4, 5, 8]);
  });

  it('drops picks that are not passages of the page', () => {
    expect(excerptPassages(passages, [[-1, 999, 1.5, 3]], 100_000)).toEqual([0, 3, 4, 5]);
  });

  it('chooses nothing when not even the opening fits', () => {
    expect(excerptPassages(passages, [[3]], lengthOf(0))).toEqual([]);
  });

  it('leaves out the passage after a pick that did not fit', () => {
    const uneven = [
      { start: 0, end: 10 },
      { start: 11, end: 21 },
      { start: 22, end: 1_000 },
      { start: 1_001, end: 1_011 },
    ];
    expect(excerptPassages(uneven, [[2]], 2 * (10 + overhead))).toEqual([0]);
  });

  it('sends a second passage after a pick only after the first, and only once every pick is in', () => {
    const tenEach = Array.from({ length: 8 }, (_, index) => ({
      start: index * 11,
      end: index * 11 + 10,
    }));
    const cost = 10 + overhead;
    // The opening, two picks, their first run-ons and one more: the second pick still comes in
    // before any second run-on.
    expect(excerptPassages(tenEach, [[2, 5]], 6 * cost)).toEqual([0, 2, 3, 4, 5, 6]);
    const firstTooLong = [
      { start: 0, end: 10 },
      { start: 11, end: 21 },
      { start: 22, end: 1_000 },
      { start: 1_001, end: 1_011 },
    ];
    expect(excerptPassages(firstTooLong, [[1]], 3 * cost)).toEqual([0, 1]);
  });

  it('runs a pick on as far as a second look asks, within the budget', () => {
    const tenEach = Array.from({ length: 12 }, (_, index) => ({
      start: index * 11,
      end: index * 11 + 10,
    }));
    const cost = 10 + overhead;
    expect(excerptPassages(tenEach, [[2]], 100 * cost)).toEqual([0, 2, 3, 4]);
    expect(excerptPassages(tenEach, [[2]], 100 * cost, secondLookRunOnPassages)).toEqual([
      0, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(excerptPassages(tenEach, [[2]], 5 * cost, secondLookRunOnPassages)).toEqual([
      0, 2, 3, 4, 5,
    ]);
  });

  it('never writes an excerpt longer than its budget', () => {
    const whole = law.length + passages.length * overhead;
    for (let budget = 0; budget <= whole; budget += 97) {
      const chosen = excerptPassages(passages, [[5, 2], [9]], budget);
      expect(excerptText(law, passages, chosen).length).toBeLessThanOrEqual(budget);
    }
  });

  it('reads an excerpt back as its runs', () => {
    expect(excerptRuns(excerptText(law, passages, [0, 1, 4]))).toEqual([
      law.slice(0, passages[1]?.end),
      law.slice(passages[4]?.start, passages[4]?.end),
    ]);
  });

  it('writes runs of neighbours as verbatim slices, with a gap line where text is left out', () => {
    const text = excerptText(law, passages, [0, 1, 4]);
    const [opening, later] = text.split(`\n${excerptGap}\n`);
    expect(opening).toBe(law.slice(0, passages[1]?.end));
    expect(later).toBe(`${law.slice(passages[4]?.start, passages[4]?.end)}\n${excerptGap}`);
    expect(law).toContain(opening);
  });

  it('marks text left out before the first passage and none after the last', () => {
    const last = passages.length - 1;
    expect(excerptText(law, passages, [last])).toBe(
      `${excerptGap}\n${law.slice(passages[last]?.start)}`,
    );
  });

  it('answers nothing when nothing is chosen', () => {
    expect(excerptText(law, passages, [])).toBe('');
  });
});

describe('the provisions a source title names (ADR-0027)', () => {
  it.each<[string, string[]]>([
    ['Aliens Act, § 9 a(2)(3) and (29): a job offer', ['9 a']],
    ['Aliens Act, § 42a(1)(a) to (d): family', ['42a']],
    ['Foreigners law, articles 58.º, n.º 5, and 99.º, n.os 1 and 4: family', ['58.º', '99.º']],
    ['Regulation, article 24.º-B, n.º 1: proof', ['24.º-B']],
    [
      'Migration Regulations 1994, Schedule 2 clauses 189.221 to 189.224: invitation',
      ['189.221', '189.224'],
    ],
    ['Migration Regulations 1994, regulation 1.05A(1): dependent', ['1.05A']],
    ['Residence act, section 4: pensioners', ['4']],
    ['Decree n.º 139/2025: minimum wage', []],
    ['Order of 12.03.2024, article 5: amounts', ['5']],
    ['Ministry page on the pay limit: DKK 552,000 in 2026', []],
    ['Immigration Law, 27. pants (1) 10): up to two years', ['27']],
    ['Civil Law, Part One (family law): art. 219, minority; art. 221, marriage', ['219', '221']],
    ['Migration Regulations 1994, Schedule 1 item 1137(4B): invited', ['1', '1137']],
    ['Employment Permits Regulations 2024, regs. 28 and 29: two years', ['28', '29']],
    ['Employment Permits Act 2024, s. 8(1)(e): section 7 does not apply', ['8']],
    ['Aliens Law, 5 straipsnis: the permit', ['5']],
    ['Ley 25.871, article 23, ñ): family reunification', ['23']],
    ['Civil and Commercial Code (Ley 26.994), articles 25 and 27: majority', ['25', '27']],
    ['Lei n.º 13.445, art. 37: family', ['37']],
    ['SIRI, accompanying family: at least 1.5 to 2 years of cohabitation', []],
    ['Code, art. 2019: an article numbered like a year', []],
    ['Immigration Rules, introduction, para. 5C: Irish citizens', ['5C']],
    ['Ley N.º 21.325, article 74: dependents', ['74']],
  ])('reads %s', (title, provisions) => {
    expect(namedProvisions(title)).toEqual(provisions);
  });
});

/** The text of the passages `provisionPassages` picks for `titles`, best first. */
const headsOf = (law: string, passages: readonly Passage[], titles: string[]) =>
  provisionPassages(law, passages, titles).map((index) => {
    const { start, end } = passages[index] ?? { start: 0, end: 0 };
    return law.slice(start, end);
  });

describe('the passages that head a named provision (ADR-0027)', () => {
  const law = [
    'Table of contents',
    '1.12 | Member of the family unit',
    'Amending act. Articles 52.º and 99.º are amended:',
    'Artigo 52.º',
    '[...]',
    ...Array.from(
      { length: 40 },
      (_, index) => `Line ${String(index)} ${'of filler text '.repeat(8)}`,
    ),
    'Artigo 52.º',
    'Recusa de visto',
    '1 — Text of article 52, in force.',
    'nos termos do',
    'artigo 52.º, pode ser dispensado.',
    ...Array.from(
      { length: 40 },
      (_, index) => `More ${String(index)} ${'of filler text '.repeat(8)}`,
    ),
    '1.12 | Member of the family unit',
    'A member of the family unit is the spouse.',
  ].join('\n');
  const passages = splitPassages(law);
  const heads = (titles: string[]) => headsOf(law, passages, titles);

  it('finds the passage a heading line of the provision opens', () => {
    const found = heads(['Foreigners law, article 52.º, n.º 3: refusal']);
    expect(found.some((text) => text.includes('Text of article 52, in force'))).toBe(true);
  });

  it('finds a provision a table row heads, the text after its contents', () => {
    const found = heads(['Regulations, regulation 1.12(2): family']);
    expect(found.some((text) => text.includes('A member of the family unit is the spouse'))).toBe(
      true,
    );
  });

  it('ranks the last heading of a provision first, ahead of its table of contents', () => {
    const [best] = heads(['Foreigners law, article 52.º, n.º 3: refusal']);
    expect(best).toContain('Text of article 52, in force');
  });

  it('finds nothing for a title that names no provision', () => {
    expect(heads(['Decree n.º 139/2025: minimum wage'])).toEqual([]);
  });
});

describe('the passages that open a named provision in the line its text runs on in', () => {
  const filler = (label: string) =>
    Array.from(
      { length: 40 },
      (_, index) => `${label} ${String(index)} ${'of filler text '.repeat(8)}`,
    );
  const law = [
    'Contents',
    ...filler('Before'),
    `27. pants. (1) Termiņuzturēšanās atļauju ārzemniekam ir tiesības pieprasīt: ${'teksts '.repeat(20)}`,
    ...filler('Latvian'),
    `SW 18.1. The applicant will be granted permission until 14 days after the end date. ${'text '.repeat(20)}`,
    ...filler('Rules'),
    `ARTICULO 23.- Los extranjeros que soliciten su residencia temporaria ingresarán. ${'texto '.repeat(20)}`,
    ...filler('Decree'),
    `Art. 3a. 1. Nie podlega opłacie skarbowej dokonanie czynności urzędowej. ${'tekst '.repeat(20)}`,
    ...filler('Ustawa'),
    'Artículo 61',
    'Residencia temporal no lucrativa',
    '3. Podrán solicitar la residencia los hijos menores.',
    ...filler('Reglamento'),
    `Note 1: The Minister must grant a visa when the applicant asks. ${'text '.repeat(20)}`,
    ...filler('Notes'),
    '1137 | Skilled—Independent (Permanent) (Class SI)',
    ...filler('Schedule'),
    'Artigo 52.º-A',
    'Text of article 52-A.',
    ...filler('Code'),
    `§ 5 Abs. 2 gilt entsprechend für die Familienangehörigen des Ausländers. ${'Text '.repeat(20)}`,
    ...filler('Gesetz'),
    `Art. 5.12. Los extranjeros podrán solicitar la residencia de larga duración. ${'texto '.repeat(20)}`,
    ...filler('Codigo'),
    'Section 6 - definitions',
    'A partner is a spouse or civil partner.',
    ...filler('Act'),
    'ARTICULO 29. — Serán causas impedientes del ingreso de extranjeros:',
    'c) haber sido condenado o tener antecedentes.',
    ...filler('Ley'),
    'Artículo 70',
    'Text of article 70 in force.',
    ...filler('Real'),
    ...Array.from(
      { length: 3 },
      (_, index) =>
        `Art. 70. Decoy ${String(index)} with a former amount of EUR 1,500 run on. ${'texto '.repeat(20)}`,
    ),
  ].join('\n');
  const passages = splitPassages(law);
  const heads = (titles: string[]) => headsOf(law, passages, titles);
  const finds = (title: string, text: string) => {
    expect(heads([title]).some((passage) => passage.includes(text))).toBe(true);
  };

  it('finds a provision whose number comes before its word', () => {
    finds('Immigration Law, 27. pants (3): family', 'Termiņuzturēšanās');
  });

  it('finds a dotted provision whose text follows on its line', () => {
    finds('Appendix Skilled Worker, SW 18.1: period of grant', 'until 14 days');
  });

  it('finds an article whose text follows a dot and a dash', () => {
    finds('Decreto 616/2010, article 23, last paragraph: family', 'residencia temporaria');
  });

  it('finds an article whose first paragraph number follows it', () => {
    finds('Ustawa o opłacie skarbowej, art. 3a ust. 1: no duty', 'Nie podlega');
  });

  it('finds the article of a paragraph that heads no line of its own', () => {
    finds('Real Decreto 1155/2024, article 61.3 b): children', 'hijos menores');
  });

  it('finds a long schedule item that opens a table row', () => {
    finds('Migration Regulations 1994, Schedule 1 item 1137(4B): invited', 'Class SI');
  });

  it('never takes a note numbered like the provision for the provision', () => {
    expect(heads(['Rules, section 1: scope']).some((text) => text.includes('The Minister'))).toBe(
      false,
    );
  });

  it('finds an article whose text follows a dot, a space and a dash', () => {
    finds('Ley 25.871, article 29, c): crimes', 'condenado o tener antecedentes');
  });

  it('finds a heading whose title follows a dash in lower case', () => {
    finds('Act, section 6: definitions', 'civil partner');
  });

  it('ranks a heading line of its own ahead of later lines that run on from the same number', () => {
    expect(heads(['Reglamento, article 70: fee'])[0]).toContain('Text of article 70 in force');
  });

  it('never takes a long sentence that cites a section for the section', () => {
    expect(heads(['Gesetz, § 5: family']).some((text) => text.includes('gilt entsprechend'))).toBe(
      false,
    );
  });

  it('never takes a paragraph numbered under an article for the article', () => {
    expect(
      heads(['Codigo, article 5: residence']).some((text) => text.includes('larga duración')),
    ).toBe(false);
  });

  it('never takes an article lettered after the number for the number', () => {
    expect(heads(['Lei, artigo 52.º: recusa']).some((text) => text.includes('52-A'))).toBe(false);
  });
});
