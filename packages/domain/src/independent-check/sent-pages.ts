import type { ReadPage } from './answers.js';
import { excerptGap, gapCost, maxWholePageText, sentWhole } from './passages.js';

/**
 * The most characters of page text one check sends the model, across every page it read: what
 * bounds the input of a call, and so its cost (ADR-0027). Each page is already capped on its own.
 */
export const maxCheckPagesText = 200_000;

/** `text` cut to at most `length` code units, never inside a surrogate pair. */
function cutAt(text: string, length: number): string {
  const cut = text.slice(0, length);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * The pages as the model is sent them, within `budget` characters in all: pages stay whole,
 * shortest first, while they fit, so as many as can still match do; the pages that do not fit
 * share what is left equally, so each still shows its opening for a difference. A page the budget
 * cuts is marked cut, so code never counts a match on it.
 */
export function withinTextBudget(
  pages: readonly ReadPage[],
  budget = maxCheckPagesText,
): ReadPage[] {
  const allowance = new Map<number, number>();
  let left = budget;
  const byLength = pages.map((page, index) => ({ index, length: page.text.length }));
  byLength.sort((a, b) => a.length - b.length);
  const fitting = byLength.findIndex(({ length }) => {
    if (length > left) return true;
    left -= length;
    return false;
  });
  const rest = fitting === -1 ? [] : byLength.slice(fitting);
  for (const { index, length } of byLength) allowance.set(index, length);
  for (const { index } of rest) allowance.set(index, Math.floor(left / rest.length));
  return pages.map((page, index) => {
    const given = allowance.get(index) ?? 0;
    if (given >= page.text.length) return page;
    return { ...page, text: cutAt(page.text, given), cut: true };
  });
}

/** A page read, and how many of the check's items cite it. */
export interface CitedText {
  readonly text: string;
  readonly citing: number;
}

/**
 * What the excerpt of each long page may hold, in page order (0 for a page sent whole): what the
 * pages sent whole leave of the check's budget, shared among the long pages by how many items cite
 * each, so a law most items rest on gets the room their provisions take, and at most the length of
 * a whole page. Room a page cannot take, past that cap, goes to the others.
 */
export function excerptBudgets(pages: readonly CitedText[], budget = maxCheckPagesText): number[] {
  const shares = pages.map(() => 0);
  const whole = pages.filter(({ text }) => sentWhole(text));
  let left = Math.max(0, budget - whole.reduce((sum, { text }) => sum + text.length, 0));
  let open = pages.flatMap((page, index) => (sentWhole(page.text) ? [] : [index]));
  while (open.length > 0 && left > 0) {
    const weights = open.map((index) => Math.max(1, pages[index]?.citing ?? 0));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const capped = open.filter(
      (index, at) => (left * (weights[at] ?? 0)) / total >= maxWholePageText,
    );
    if (capped.length === 0) {
      open.forEach((index, at) => {
        shares[index] = Math.floor((left * (weights[at] ?? 0)) / total);
      });
      break;
    }
    for (const index of capped) shares[index] = maxWholePageText;
    left -= capped.length * maxWholePageText;
    open = open.filter((index) => !capped.includes(index));
  }
  return shares;
}

/**
 * The opening of a long page as an excerpt of at most `budget` characters, for when no passage
 * of it could be picked: the text that fits, then a gap line.
 */
export function openingExcerpt(text: string, budget: number): string {
  const room = budget - gapCost;
  if (room <= 0) return '';
  return text.length <= room ? text : `${cutAt(text, room)}\n${excerptGap}`;
}
