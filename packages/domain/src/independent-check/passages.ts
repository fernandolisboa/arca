/** A passage of a page: a run of its text, as offsets into that text. */
export interface Passage {
  readonly start: number;
  readonly end: number;
}

/**
 * A page up to this many characters is sent whole. A longer one is sent as an excerpt of the
 * passages a locator picked for the items that cite it, at most this long (ADR-0027).
 */
export const maxWholePageText = 60_000;

/** Whether a page's text goes to the model whole, not as an excerpt. */
export const sentWhole = (text: string) => text.length <= maxWholePageText;

/** The most passages a locator may pick for one item on one page. */
export const maxPassagesPerItem = 6;

/** The line an excerpt writes where it leaves page text out. */
export const excerptGap = '[…]';

/** What one gap line adds to an excerpt: the line and its line break. */
export const gapCost = excerptGap.length + 1;

/** A line this short may be a heading, so a passage may start at it and an outline shows it. */
const headingLength = 120;
const minHeadingLength = 3;
const minPassageLength = 800;
/** A passage that reaches this share of the shortest length may end at the next heading. */
const headingShare = 0.4;
/** No passage is much longer than this many times the shortest. */
const maxPassageMultiple = 3;
/** A page's outline has at most about this many entries, so a long law's passages grow with it. */
const maxOutlineEntries = 1_500;
const outlineEntryLength = 320;
const outlineSeparator = ' · ';

/** How a list item opens: a dash or bullet, or a short number or letter with a dot or bracket. */
const listMarker = /^(?:[-–—•*]|\(?(?:\d{1,3}|\p{L}{1,2}|[ivxIVX]{1,4})[).])\s/u;

const blank = (line: string) => line.trim() === '';

const shortLine = (line: string) =>
  line.trim().length >= minHeadingLength && line.length <= headingLength;

/**
 * Whether a line reads as a heading: short, and not a list item. Laws in every language name their
 * articles and sections on such lines, so no word of any one language is looked for.
 */
function headingLike(line: string): boolean {
  return shortLine(line) && !listMarker.test(line);
}

const whitespace = /\s/u;

/**
 * The last whitespace in `text` at or before `limit` and after the first words that follow
 * `from`, so the piece before it is never blank; else `limit` itself.
 */
function breakBefore(text: string, from: number, limit: number): number {
  let first = from;
  while (first < limit && whitespace.test(text.charAt(first))) first += 1;
  for (let index = limit; index > first; index -= 1) {
    if (whitespace.test(text.charAt(index))) return index;
  }
  return limit;
}

/**
 * A page's text as passages that cover it end to end, in order: each a run of whole lines, begun
 * at a heading where one comes, else at another short line, and never much longer than three
 * times the shortest. Only a single line longer than that is split, at whitespace. Adjacent
 * passages are contiguous but for the line break between them, so a run of them is a verbatim
 * slice of the page.
 */
export function splitPassages(text: string): Passage[] {
  const min = Math.max(
    minPassageLength,
    Math.ceil(text.length / (maxOutlineEntries * headingShare)),
  );
  const max = min * maxPassageMultiple;
  const passages: Passage[] = [];
  let start = 0;
  let position = 0;
  // Whether the passage being built holds words yet, kept as a flag so no line is read twice.
  let hasWords = false;
  while (position < text.length) {
    const newline = text.indexOf('\n', position);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(position, lineEnd);
    const soFar = position - start;
    const breaksHere =
      (soFar >= min * headingShare && headingLike(line)) ||
      (soFar >= min && !blank(line) && line.length <= headingLength) ||
      soFar + line.length > max;
    // Blank lines make no passage of their own: they stay with the text after them.
    if (breaksHere && hasWords) {
      passages.push({ start, end: position - 1 });
      start = position;
      hasWords = false;
    }
    let split = false;
    while (lineEnd - start > max) {
      const end = breakBefore(text, start, start + max);
      passages.push({ start, end });
      start = end;
      split = true;
    }
    hasWords = split ? !blank(text.slice(start, lineEnd)) : hasWords || !blank(line);
    position = lineEnd + 1;
  }
  if (start < text.length) passages.push({ start, end: text.length });
  return passages;
}

/**
 * A line of the page as a piece of an outline entry: on one line whatever the page wrote, and with
 * no bracketed number of its own, in any bracket or digit a reader takes for one, so page text
 * cannot pass for another passage's entry.
 */
const outlinePiece = (line: string) =>
  line
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/[[［【〔]\s*(\p{Nd}+)\s*[\]］】〕]/gu, '($1)');

/**
 * One line per passage for a locator to pick from: the passage's number, how it opens, then the
 * headings in it and, while there is room, its other short lines.
 */
export function pageOutline(text: string, passages: readonly Passage[]): string {
  return passages
    .map(({ start, end }, index) => {
      const lines = text
        .slice(start, end)
        .split('\n')
        .map(outlinePiece)
        .filter((line) => line.trim() !== '');
      const [first = '', ...rest] = lines;
      const parts = [first.slice(0, headingLength)];
      let length = parts[0]?.length ?? 0;
      const short = rest.filter(shortLine);
      const headingsFirst = [
        ...short.filter(headingLike),
        ...short.filter((line) => !headingLike(line)),
      ];
      for (const line of headingsFirst) {
        if (length + line.length + outlineSeparator.length > outlineEntryLength) break;
        parts.push(line);
        length += line.length + outlineSeparator.length;
      }
      return `[${String(index)}] ${parts.join(outlineSeparator)}`;
    })
    .join('\n');
}

/**
 * The passages to send of a long page, within `budget` characters: the page's opening, which
 * carries its title and the date of its text, then, rank by rank, every item's pick and after
 * those the passage that follows each, since a provision often runs on. Out-of-range picks are
 * dropped. When not even the opening fits, nothing is chosen.
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
    // Each passage may open a run, and each run is followed by at most one gap line.
    const cost = passage.end - passage.start + 1 + gapCost;
    if (cost > left) return;
    chosen.add(index);
    left -= cost;
  };
  take(0);
  if (!chosen.has(0)) return [];
  const deepest = Math.max(0, ...picks.map((ranked) => ranked.length));
  for (let rank = 0; rank < deepest; rank += 1) {
    const ranked = picks.flatMap((ofItem) => {
      const pick = ofItem[rank];
      return pick === undefined ? [] : [pick];
    });
    for (const pick of ranked) take(pick);
    for (const pick of ranked) if (chosen.has(pick)) take(pick + 1);
  }
  return [...chosen].sort((one, other) => one - other);
}

/**
 * The chosen passages as the text sent for the page: each run of neighbours is one verbatim slice
 * of the page, and a gap line stands wherever text is left out, so a quote that is within one run
 * of the excerpt is on the page.
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

/** The runs of an excerpt: the verbatim slices of the page between its gap lines. */
export function excerptRuns(excerpt: string): string[] {
  const runs: string[][] = [[]];
  for (const line of excerpt.split('\n')) {
    if (line === excerptGap) runs.push([]);
    else runs.at(-1)?.push(line);
  }
  return runs.map((lines) => lines.join('\n')).filter((run) => run !== '');
}
