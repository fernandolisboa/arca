import { describe, expect, it } from 'vitest';
import type { ReadPage } from '../../src/independent-check/answers.js';
import { excerptGap, maxWholePageText } from '../../src/independent-check/passages.js';
import {
  checkCalls,
  excerptBudgets,
  maxCallsPerCheck,
  maxItemsPerCall,
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
  const cited = (text: string, citing = 1) => ({ text, citing });

  it.each<[string, { text: string; citing: number }[], number, number[]]>([
    [
      'a whole page at most, however much is left',
      [cited(long), cited('aaa')],
      200_000,
      [maxWholePageText, 0],
    ],
    [
      'an equal share among long pages cited alike',
      [cited(long), cited(long), cited(long), cited(long)],
      200_000,
      [50_000, 50_000, 50_000, 50_000],
    ],
    [
      'what the pages sent whole leave',
      [cited(short), cited(short), cited(short), cited(long), cited(long)],
      200_000,
      [0, 0, 0, 10_000, 10_000],
    ],
    [
      'nothing once the whole pages fill the budget',
      [cited(short), cited(short), cited(long)],
      100_000,
      [0, 0, 0],
    ],
    [
      'shares by how many items cite each page',
      [cited(long, 3), cited(long, 1)],
      40_000,
      [30_000, 10_000],
    ],
    [
      'a page no item cites a share as if one did',
      [cited(long, 0), cited(long, 1)],
      40_000,
      [20_000, 20_000],
    ],
    [
      "the room past a page's cap to the other pages",
      [cited(long, 9), cited(long, 1)],
      100_000,
      [maxWholePageText, 40_000],
    ],
  ])('gives %s', (_, pages, budget, expected) => {
    expect(excerptBudgets(pages, budget)).toEqual(expected);
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

describe('the checker calls of one check (ADR-0027)', () => {
  const items = (count: number, url = 'https://a.example') =>
    Array.from({ length: count }, (_, index) => ({ key: `k${String(index)}`, urls: [url] }));
  const keys = (calls: readonly (readonly { key: string }[])[]) =>
    calls.map((call) => call.map(({ key }) => key));

  it('compares every item in one call when the pages fit whole', () => {
    const many = items(20);
    expect(checkCalls(many, [page('https://a.example', 1_000)], 2_000)).toEqual([many]);
  });

  it('splits consecutive items into calls when a page is long', () => {
    const many = items(maxItemsPerCall + 1);
    const calls = checkCalls(many, [page('https://a.example', maxWholePageText + 1)]);
    expect(keys(calls)).toEqual([
      many.slice(0, maxItemsPerCall).map(({ key }) => key),
      [`k${String(maxItemsPerCall)}`],
    ]);
  });

  it('splits when the pages together exceed the budget', () => {
    const calls = checkCalls(items(maxItemsPerCall * 2), [page('https://a.example', 300)], 200);
    expect(calls).toHaveLength(2);
  });

  it('ignores pages no item cites when judging the fit', () => {
    const few = items(3);
    expect(
      checkCalls(few, [page('https://a.example', 10), page('https://b.example', 500)], 100),
    ).toEqual([few]);
  });

  it('never makes more than the most calls a check may', () => {
    const many = items(maxItemsPerCall * maxCallsPerCheck * 2);
    const calls = checkCalls(many, [page('https://a.example', maxWholePageText + 1)]);
    expect(calls).toHaveLength(maxCallsPerCheck);
    expect(calls.flat()).toEqual(many);
  });

  it('makes no call without items', () => {
    expect(checkCalls([], [page('https://a.example', 10)])).toEqual([]);
  });
});
