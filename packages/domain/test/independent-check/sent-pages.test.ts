import { describe, expect, it } from 'vitest';
import type { ReadPage } from '../../src/independent-check/answers.js';
import { excerptGap, maxWholePageText } from '../../src/independent-check/passages.js';
import {
  excerptBudget,
  openingExcerpt,
  withinTextBudget,
} from '../../src/independent-check/sent-pages.js';

const page = (url: string, length: number, cut = false): ReadPage => ({
  url,
  text: 'a'.repeat(length),
  cut,
  chain: [url],
});

const lengths = (pages: readonly ReadPage[]) => pages.map(({ text }) => text.length);

describe('the total page text one check sends (ADR-0027)', () => {
  it('leaves pages within the budget as they are', () => {
    const pages = [page('https://a.example', 30), page('https://b.example', 40)];
    const sent = withinTextBudget(pages, 100);
    expect(sent).toEqual(pages);
  });

  it('keeps pages whole, shortest first, and shares the rest equally among those that do not fit', () => {
    const sent = withinTextBudget(
      [
        page('https://a.example', 500),
        page('https://b.example', 10),
        page('https://c.example', 300),
      ],
      110,
    );
    expect(lengths(sent)).toEqual([50, 10, 50]);
    expect(sent.map(({ cut }) => cut)).toEqual([true, false, true]);
    expect(sent.map(({ url }) => url)).toEqual([
      'https://a.example',
      'https://b.example',
      'https://c.example',
    ]);
  });

  it('keeps as many long pages whole as fit, rather than cutting them all', () => {
    const sent = withinTextBudget(
      [55, 55, 55, 55].map((length, i) => page(`https://p${String(i)}.example`, length)),
      200,
    );
    expect(lengths(sent)).toEqual([55, 55, 55, 35]);
    expect(sent.map(({ cut }) => cut)).toEqual([false, false, false, true]);
  });

  it('never sends more than the budget, whatever the pages', () => {
    const pages = [7, 1_000, 13, 999, 250, 0].map((length, i) =>
      page(`https://p${String(i)}.example`, length),
    );
    for (const budget of [0, 1, 17, 500, 1_200, 5_000]) {
      const sent = withinTextBudget(pages, budget);
      expect(lengths(sent).reduce((sum, length) => sum + length, 0)).toBeLessThanOrEqual(budget);
    }
  });

  it('keeps a page cut by its own cap marked cut', () => {
    const [sent] = withinTextBudget([page('https://a.example', 10, true)], 100);
    expect(sent?.cut).toBe(true);
  });

  it('never cuts inside a surrogate pair', () => {
    const emoji = { url: 'https://a.example', text: 'ab😀cd', cut: false, chain: [] };
    const [sent] = withinTextBudget([emoji], 3);
    expect(sent?.text).toBe('ab');
    expect(sent?.cut).toBe(true);
  });
});

describe('what the excerpt of a long page may hold (ADR-0027)', () => {
  const short = 'a'.repeat(maxWholePageText);
  const long = 'a'.repeat(maxWholePageText + 1);

  it.each<[string, string[], number, number]>([
    ['a whole page at most, however much is left', [long, 'aaa'], 200_000, maxWholePageText],
    ['an equal share among the long pages', [long, long, long, long], 200_000, 50_000],
    ['what the pages sent whole leave', [short, short, short, long, long], 200_000, 10_000],
    ['nothing once the whole pages fill the budget', [short, short, long], 100_000, 0],
  ])('gives %s', (_, texts, budget, expected) => {
    expect(excerptBudget(texts, budget)).toBe(expected);
  });
});

describe('the opening sent of a long page no passage was picked for (ADR-0027)', () => {
  it('writes the text that fits, then a gap line, within the budget', () => {
    expect(openingExcerpt('abcdefghij', 8)).toBe(`abcd\n${excerptGap}`);
  });

  it('writes nothing when the budget holds no text', () => {
    expect(openingExcerpt('abcdefghij', excerptGap.length + 1)).toBe('');
    expect(openingExcerpt('abcdefghij', 0)).toBe('');
  });

  it('never cuts inside a surrogate pair', () => {
    expect(openingExcerpt('ab😀cd', 3 + excerptGap.length + 1)).toBe(`ab\n${excerptGap}`);
  });
});
