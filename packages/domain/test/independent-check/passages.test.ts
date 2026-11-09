import { describe, expect, it } from 'vitest';
import {
  excerptGap,
  excerptPassages,
  excerptText,
  pageOutline,
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

  it('takes the opening, then each pick with the passage after it', () => {
    expect(excerptPassages(passages, [[5], [2]], 100_000)).toEqual([0, 2, 3, 5, 6]);
  });

  it('serves every item its best pick before any second pick, within the budget', () => {
    const budget = lengthOf(0) + lengthOf(4) + lengthOf(5) + lengthOf(8) + 4 * 10;
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
    expect(excerptPassages(passages, [[-1, 999, 1.5, 3]], 100_000)).toEqual([0, 3, 4]);
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
