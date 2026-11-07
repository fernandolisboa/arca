import { describe, expect, it } from 'vitest';
import type { ReadPage } from '../../src/independent-check/answers.js';
import { withinTextBudget } from '../../src/independent-check/sent-pages.js';

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

  it('keeps short pages whole and shares the rest equally among the long ones', () => {
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
