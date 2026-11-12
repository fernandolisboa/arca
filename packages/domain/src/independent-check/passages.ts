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

/** The words a catalog source title names a provision with, before its number. */
const provisionWord =
  /(?:\b(?:[Aa]rticles?|[Aa]rt\.|[Ss]ections?|[Cc]lauses?|[Rr]egulations?|[Rr]ules?|[Pp]aragraphs?|[Ii]tems?|[Ss]chedules?|[Aa]nnex(?:es)?)|§§?)\s*(\d+(?:\.\d+)*(?:\.?[ºª])?(?:-?[A-Z](?![\p{L}])|[a-z](?![\p{L}]))?(?: [a-z](?![\p{L}]))?)/gu;

/** A date written with dots (12.03.2024), which is not a provision. */
const dottedDate = /^\d{1,2}\.\d{1,2}\.\d{2,4}$/u;

/** A number only a provision is written with: an ordinal mark (52.º) or a dotted one (189.211). */
const markedNumber = /(?<![\p{L}\p{N}.])(\d+(?:\.?[ºª](?:-[A-Z]+)?|(?:\.\d+)+[A-Z]?))(?![\p{N}])/gu;

/**
 * The provisions a source title names, before its first colon: the number after a word such as
 * "article", "section", "clause" or "§" ("§ 9 a(4)" names `9 a`), and any number written the way
 * only provisions are (`52.º`, `24.º-B`, `189.211`). Catalog titles are written in English.
 */
export function namedProvisions(title: string): string[] {
  const head = title.split(':')[0] ?? '';
  const found = [
    ...[...head.matchAll(provisionWord)].map((match) => match[1] ?? ''),
    ...[...head.matchAll(markedNumber)].map((match) => match[1] ?? ''),
  ];
  const named = [
    ...new Set(found.filter((designator) => designator !== '' && !dottedDate.test(designator))),
  ];
  // A plain number is too common to look for beside a marked one ("Schedule 2 clause 189.211"),
  // and a plain four-digit one is the year of an act's name.
  const marked = named.filter((designator) => !/^\d+$/u.test(designator));
  return marked.length > 0 ? marked : named.filter((designator) => !/^\d{4}$/u.test(designator));
}

/**
 * The most passages one named provision adds to an item's picks: the last ones that head it, since
 * a table of contents or an amending act's list comes before the text itself.
 */
const maxPassagesPerProvision = 3;

/**
 * Whether `line` opens with `designator` as a token of its own, after at most one word or a
 * section sign ("Artigo 52.º", "§ 9 a.", "189.211"), as a provision's heading does; a line that
 * mentions it further on cites it, and does not head it.
 */
const plainDesignator = /^\d+(?: ?[a-zA-Z])?$/u;

function headsProvision(line: string, designator: string): boolean {
  const at = line.indexOf(designator);
  if (at === -1) return false;
  const rest = line.slice(at + designator.length);
  // A heading ends with the number or goes on to its title; "artigo 52.º, pode" is a sentence.
  const heads = /^(?:[.:]?\s*$|[.:]?\s+\p{Lu}|\s*\|\s*\p{Lu}|\s*[-–—]\s)/u.test(rest);
  // A plain number ("4", "9 a") also opens numbered paragraphs, so it needs its word or a §.
  const prefix = plainDesignator.test(designator)
    ? /^\s*(?:[\p{L}]+\.?\s+|§+\s*)$/u
    : /^\s*(?:[\p{L}]+\.?\s+|§+\s*)?$/u;
  return heads && prefix.test(line.slice(0, at));
}

/**
 * The passages of a page whose heading lines open with a provision the titles name, best first:
 * the last `maxPassagesPerProvision` for each, last first, the provisions taking turns; the article a source cites is found by its number,
 * whatever a passage locator picks, in any language, since only the number is compared.
 */
export function provisionPassages(
  text: string,
  passages: readonly Passage[],
  titles: readonly string[],
): number[] {
  const designators = [...new Set(titles.flatMap(namedProvisions))];
  if (designators.length === 0) return [];
  const found = new Map<string, number[]>(designators.map((designator) => [designator, []]));
  passages.forEach(({ start, end }, index) => {
    for (const line of text.slice(start, end).split('\n')) {
      if (!headingLike(line)) continue;
      for (const designator of designators) {
        const hits = found.get(designator) ?? [];
        if (hits.at(-1) !== index && headsProvision(line, designator)) hits.push(index);
      }
    }
  });
  const ranked = [...found.values()].map((hits) => hits.slice(-maxPassagesPerProvision).reverse());
  const turns = Array.from({ length: maxPassagesPerProvision }, (_, turn) =>
    ranked.flatMap((hits) => hits.slice(turn, turn + 1)),
  );
  return [...new Set(turns.flat())];
}
