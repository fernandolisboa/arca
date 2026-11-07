import type { ReadPage } from './answers.js';

/**
 * The most characters of page text one check sends the model, across every page it read: what
 * bounds the input of a call, and so its cost (ADR-0027). Each page is already capped on its own.
 */
export const maxCheckPagesText = 240_000;

/**
 * Text framed as data for a model: angle brackets become look-alikes, so nothing in it can close
 * or open a delimiter of the prompt. A page's text is sent, and its quotes checked, in this form.
 */
export function asDataText(text: string): string {
  return text.replace(/</gu, '‹').replace(/>/gu, '›');
}

/** `text` cut to at most `length` code units, never inside a surrogate pair. */
function cutAt(text: string, length: number): string {
  const cut = text.slice(0, length);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * The pages as the model is sent them, within `budget` characters in all: a short page keeps its
 * whole text and the longest share what is left equally, so no page loses everything to the pages
 * before it. A page the budget cuts is marked cut, so code never counts a match on it.
 */
export function withinTextBudget(
  pages: readonly ReadPage[],
  budget = maxCheckPagesText,
): ReadPage[] {
  const allowance = new Map<number, number>();
  let left = budget;
  const byLength = pages.map((page, index) => ({ index, length: page.text.length }));
  byLength.sort((a, b) => a.length - b.length);
  byLength.forEach(({ index, length }, position) => {
    const share = Math.floor(left / (byLength.length - position));
    const given = Math.min(length, share);
    allowance.set(index, given);
    left -= given;
  });
  return pages.map((page, index) => {
    const given = allowance.get(index) ?? 0;
    if (given >= page.text.length) return page;
    return { ...page, text: cutAt(page.text, given), cut: true };
  });
}
