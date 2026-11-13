import { describe, expect, it } from 'vitest';
import {
  excerptGap,
  excerptPassages,
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
  ])('reads %s', (title, provisions) => {
    expect(namedProvisions(title)).toEqual(provisions);
  });
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
  const heads = (titles: string[]) =>
    provisionPassages(law, passages, titles).map((index) => {
      const { start, end } = passages[index] ?? { start: 0, end: 0 };
      return law.slice(start, end);
    });

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
