/** A passage of a page: a run of its text, as offsets into that text. */
export interface Passage {
  readonly start: number;
  readonly end: number;
}

/**
 * A page up to this many characters is sent whole. A longer one is sent as an excerpt of the
 * passages a locator picked for the items that cite it, at most this long (ADR-0027).
 */
export const maxWholePageText = 40_000;

/** The most passages a locator may pick for one item on one page. */
export const maxPassagesPerItem = 6;

/** The line an excerpt writes where it leaves page text out. */
export const excerptGap = '[…]';

/** A line this short may be a heading, so a passage may start at it and an outline shows it. */
const headingLength = 120;
const minPassageLength = 800;
/** A passage that reaches this share of the shortest length may end at the next heading. */
const headingShare = 0.4;
/** A page's outline has at most about this many entries, so a long law's passages grow with it. */
const maxOutlineEntries = 1_500;
const outlineEntryLength = 320;

/** How a list item opens: a dash or bullet, or a short number or letter with a dot or bracket. */
const listMarker = /^(?:[-–—•*]|\(?(?:\d{1,3}|\p{L}{1,2}|[ivxIVX]{1,4})[).])\s/u;

/**
 * Whether a line reads as a heading: short, and not a list item. Laws in every language name their
 * articles and sections on such lines, so no word of any one language is looked for.
 */
function headingLike(line: string): boolean {
  return line.length >= 3 && line.length <= headingLength && !listMarker.test(line);
}

/** The last whitespace in `text` at or before `limit` and after `from`, or `limit` itself. */
function breakBefore(text: string, from: number, limit: number): number {
  for (let index = limit; index > from; index -= 1) {
    if (/\s/u.test(text.charAt(index))) return index;
  }
  return limit;
}

/**
 * A page's text as passages that cover it end to end, in order: each a run of whole lines, begun
 * at a heading where one comes, else at another short line, and never much longer than three
 * times the shortest. Only a single line longer than that is split, at whitespace.
 * Adjacent passages are contiguous but for the line break between them, so a run of them is a
 * verbatim slice of the page.
 */
export function splitPassages(text: string): Passage[] {
  const min = Math.max(
    minPassageLength,
    Math.ceil(text.length / (maxOutlineEntries * headingShare)),
  );
  const max = min * 3;
  const passages: Passage[] = [];
  let start = 0;
  let position = 0;
  while (position < text.length) {
    const newline = text.indexOf('\n', position);
    const lineEnd = newline === -1 ? text.length : newline;
    const lineLength = lineEnd - position;
    const soFar = position - start;
    const breaksHere =
      (soFar >= min * headingShare && headingLike(text.slice(position, lineEnd))) ||
      (soFar >= min && lineLength <= headingLength) ||
      soFar + lineLength > max;
    if (soFar > 0 && breaksHere) {
      passages.push({ start, end: position - 1 });
      start = position;
    }
    while (lineEnd - start > max) {
      const end = breakBefore(text, start, start + max);
      passages.push({ start, end });
      start = end;
    }
    position = lineEnd + 1;
  }
  if (start < text.length) passages.push({ start, end: text.length });
  return passages;
}

/**
 * One line per passage for a locator to pick from: the passage's number, how it opens, then the
 * headings in it and, while there is room, its other short lines.
 */
export function pageOutline(text: string, passages: readonly Passage[]): string {
  return passages
    .map(({ start, end }, index) => {
      const [first = '', ...rest] = text.slice(start, end).split('\n');
      const parts = [first.slice(0, headingLength)];
      let length = parts[0]?.length ?? 0;
      const short = rest.filter((line) => line.length >= 3 && line.length <= headingLength);
      for (const line of [...short.filter(headingLike), ...short.filter((l) => !headingLike(l))]) {
        if (length + line.length + 3 > outlineEntryLength) break;
        parts.push(line);
        length += line.length + 3;
      }
      return `[${String(index)}] ${parts.join(' · ')}`;
    })
    .join('\n');
}

/**
 * The passages to send of a long page, within `budget` characters: the page's opening, which
 * carries its title and the date of its text, then each item's picks in turn, best first, each
 * with the passage after it, since a provision often runs on. Out-of-range picks are dropped.
 */
export function excerptPassages(
  passages: readonly Passage[],
  picks: readonly (readonly number[])[],
  budget: number,
): number[] {
  const chosen = new Set<number>();
  let left = budget;
  const take = (index: number) => {
    const passage = passages[index];
    if (passage === undefined || chosen.has(index)) return;
    const cost = passage.end - passage.start + excerptGap.length + 2;
    if (cost > left) return;
    chosen.add(index);
    left -= cost;
  };
  take(0);
  const deepest = Math.max(0, ...picks.map((ranked) => ranked.length));
  for (let rank = 0; rank < deepest; rank += 1) {
    for (const ranked of picks) {
      const pick = ranked[rank];
      if (pick === undefined) continue;
      take(pick);
      take(pick + 1);
    }
  }
  return [...chosen].sort((left, right) => left - right);
}

/**
 * The chosen passages as the text sent for the page: each run of neighbours is one verbatim slice
 * of the page, and a gap line stands wherever text is left out, so a quote that is on the excerpt
 * is on the page.
 */
export function excerptText(
  text: string,
  passages: readonly Passage[],
  chosen: readonly number[],
): string {
  const runs: string[] = [];
  let run: { first: Passage; last: Passage; lastIndex: number } | undefined;
  const close = () => {
    if (run === undefined) return;
    if (runs.length > 0) runs.push(excerptGap);
    runs.push(text.slice(run.first.start, run.last.end));
  };
  for (const index of chosen) {
    const passage = passages[index];
    if (passage === undefined) continue;
    if (run !== undefined && index === run.lastIndex + 1) {
      run = { first: run.first, last: passage, lastIndex: index };
      continue;
    }
    close();
    run = { first: passage, last: passage, lastIndex: index };
  }
  close();
  if (run === undefined) return '';
  const first = passages[chosen[0] ?? 0];
  return [
    ...(first !== undefined && first.start > 0 ? [excerptGap] : []),
    ...runs,
    ...(run.last.end < text.length ? [excerptGap] : []),
  ].join('\n');
}
