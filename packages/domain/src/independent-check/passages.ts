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

/**
 * How many passages after a pick an excerpt also sends, in turn and within its budget: an article
 * with numbered paragraphs often runs past the passage its heading opens (ADR-0027).
 */
const runOnPassages = 2;

/**
 * How many passages after a pick a second look sends (ADR-0027): it compares few items, so their
 * provisions may run on to their end within the budget the first comparison shared among many.
 */
export const secondLookRunOnPassages = 8;

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
 * those the passage that follows each, since a provision often runs on; then, with what is left,
 * the further passages after each pick, up to `runOn`. Out-of-range picks are
 * dropped. When not even the opening fits, nothing is chosen.
 */
export function excerptPassages(
  passages: readonly Passage[],
  picks: readonly (readonly number[])[],
  budget: number,
  runOn = runOnPassages,
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
  // Further run-on passages only spend what every rank's picks left over.
  const kept = picks.flat().filter((pick) => chosen.has(pick));
  for (let after = 2; after <= runOn; after += 1) {
    for (const pick of kept) if (chosen.has(pick + after - 1)) take(pick + after);
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
  /(?:\b(?:[Aa]rticles?|[Aa]rt\.|[Ss]ections?|[Cc]lauses?|[Rr]egulations?|[Rr]ules?|[Pp]aragraphs?|[Ii]tems?|[Ss]chedules?|[Aa]nnex(?:es)?)|§§?)\s*(\d+(?:\.\d+)*(?:\.?[ºª])?(?:-?[A-Z](?![\p{L}])|[a-z](?![\p{L}]))?(?: [a-z](?![\p{L}]))?)((?:(?:, ?| and )\d+[a-z]?(?![\p{L}\p{N}.]))*)/gu;

/** Each further number of a list after a provision's word: "articles 25 and 27", "art. 2, 4". */
const listedNumber = /(?:, ?| and )(\d+[a-z]?)/gu;

/** A date written with dots (12.03.2024), which is not a provision. */
const dottedDate = /^\d{1,2}\.\d{1,2}\.\d{2,4}$/u;

/** A number only a provision is written with: an ordinal mark (52.º) or a dotted one (189.211). */
const markedNumber = /(?<![\p{L}\p{N}.])(\d+(?:\.?[ºª](?:-[A-Z]+)?|(?:\.\d+)+[A-Z]?))(?![\p{N}])/gu;

/**
 * The words some languages write after a provision's number, as Latvian "27. pants" and Lithuanian
 * "5 straipsnis" do.
 */
const postfixWord = String.raw`(?:pants|panta|straipsnis|straipsnio)(?![\p{L}])`;

/** A number with a word after it that names a provision: `27. pants` names `27`. */
const postfixProvision = new RegExp(String.raw`(?<![\p{L}\p{N}.])(\d+)\.?\s*${postfixWord}`, 'gu');

/** The number and letter of a provision named by an abbreviation, and of each one listed after it. */
const abbreviatedNumber = String.raw`\d+(?:\.\d+)*(?:-?[A-Z](?![\p{L}])|[a-z](?![\p{L}]))?`;

/** Abbreviations English titles name provisions with, beside the full words: "regs. 28 and 29". */
const provisionAbbreviation = new RegExp(
  String.raw`\b(?:[Rr]egs?\.|[Pp]aras?\.|[Ss]s?\.)\s*(${abbreviatedNumber}(?:(?:, ?| and )${abbreviatedNumber})*)`,
  'gu',
);

/** What comes before an act's own number ("Ley N.º 21.325", "Lei n.º 13.445", "Ley 18.250"). */
const actNumber =
  /(?:\b[Nn]\.?\s?[ºo°]|\bNo\.|\bn\.|\b(?:Ley|Lei|Legge|Law|Act|Decreto|Decree))\s*$/u;

/** A year, which a plain four-digit number in an act's name ("Regulations 1994") is. */
const year = /^(?:1[89]|20)\d\d$/u;

/**
 * The provisions one piece of a source title names: after a word or abbreviation, before a postfix
 * word, and, when `marked`, any number written only the way provisions are, save an act's own
 * number. Years are left out.
 */
function provisionsIn(text: string, marked: boolean): string[] {
  return [
    ...[...text.matchAll(provisionWord)].flatMap((match) => [
      match[1] ?? '',
      ...[...(match[2] ?? '').matchAll(listedNumber)].map((listed) => listed[1] ?? ''),
    ]),
    ...[...text.matchAll(provisionAbbreviation)].flatMap((match) =>
      (match[1] ?? '').split(/, ?| and /u),
    ),
    ...[...text.matchAll(postfixProvision)].map((match) => match[1] ?? ''),
    ...(marked
      ? [...text.matchAll(markedNumber)]
          .filter(({ index }) => !actNumber.test(text.slice(0, index)))
          .map((match) => match[1] ?? '')
      : []),
  ].filter(
    (designator) => designator !== '' && !dottedDate.test(designator) && !year.test(designator),
  );
}

/**
 * The provisions a source title names, before its first colon, or after it when that part names
 * none ("Civil Law, Part One: art. 219"): the number after a word such as "article", "section",
 * "clause", "reg." or "§" ("§ 9 a(4)" names `9 a`), the number before a word that some languages
 * write after it ("27. pants"), and, before the colon, any number written the way only provisions
 * are (`52.º`, `24.º-B`, `189.211`). Catalog titles are written in English, citing provisions as
 * the law does.
 */
export function namedProvisions(title: string): string[] {
  const head = title.split(':')[0] ?? '';
  const inHead = provisionsIn(head, true);
  // After the colon a title describes the provision, so only numbers a word names count there:
  // its amounts and act numbers ("1.5 to 2 years", "Ley 18.250") are not provisions.
  const named = [...new Set(inHead.length > 0 ? inHead : provisionsIn(title, false))];
  // A plain number is too common to look for beside a marked one ("Schedule 2 clause 189.211").
  const marked = named.filter((designator) => !/^\d+$/u.test(designator));
  return marked.length > 0 ? marked : named;
}

/**
 * The most passages one named provision adds to an item's picks: the last ones that head it, since
 * a table of contents or an amending act's list comes before the text itself.
 */
const maxPassagesPerProvision = 3;

/** A designator that is a bare number, with at most a letter: it also numbers paragraphs and rows. */
const plainDesignator = /^\d+(?: ?[a-zA-Z])?$/u;

/**
 * What follows a provision's number on the line that opens it: nothing, or its title or first
 * sentence after a dot, colon, dash or space ("ARTICULO 23.- Los", "Art. 3a. 1. Nie", "SW 18.1. The"),
 * or a table cell, with an ordinal mark first where the law writes one ("Artículo 4°.-").
 */
const headingRest =
  /^[ºª°]?(?:[.:]?\s*$|(?:[.:]?\s*[-–—]+\s+|[.:][-–—]*\s*|\s+)\p{Lu}|[.:][-–—]*\s+(?:\d+\.|\(\d+\))\s*\p{Lu}|\s*[-–—]\s|\s*\|\s*\p{Lu})/u;

/**
 * On a line too long to be a heading, the number must be followed by a dot, colon or dash before
 * the text ("SW 18.1. The", "ARTICULO 23.- Los"); a bare space ("§ 5 Abs. 2 gilt") is a sentence
 * that cites it.
 */
const runOnRest = /^[ºª°]?(?:[.:]|\s*[-–—]+\s)/u;

/**
 * Whether `line` opens with `designator` as a token of its own, after at most one word or a
 * section sign ("Artigo 52.º", "§ 9 a.", "189.211"), as a provision's heading does; a line that
 * mentions it further on cites it, and does not head it.
 */
function headsProvision(line: string, designator: string): boolean {
  const at = line.indexOf(designator);
  if (at === -1) return false;
  const rest = line.slice(at + designator.length);
  // A heading ends with the number or goes on to its title; "artigo 52.º, pode" is a sentence.
  const heads = headingRest.test(rest);
  // A plain number ("4", "9 a") also opens numbered paragraphs, so it needs its word or a §,
  // unless a long one opens a table row ("1137 | Skilled—Independent"), as a schedule's items do.
  const tableItem = /^\d{3,}$/u.test(designator) && /^\s*\|/u.test(rest);
  const prefix =
    plainDesignator.test(designator) && !tableItem
      ? /^\s*(?:[\p{L}]+\.?\s+|§+\s*)$/u
      : /^\s*(?:[\p{L}]+\.?\s+|§+\s*)?$/u;
  return heads && prefix.test(line.slice(0, at));
}

/** A line that opens with a word for an article, in the languages that write one before its number. */
const articleWord = /^\s*(?:art(?:\.|[ií]culo|icle|igo|ikel|ykuł|icolo)|§)/iu;

/** A line that opens with a number and a word written after a provision's number: `27. pants`. */
const postfixHeading = new RegExp(String.raw`^\s*(\d+)\.?\s*${postfixWord}`, 'u');

/** Whether `line` opens with `designator` and a word written after a provision's number. */
function opensWithPostfixWord(line: string, designator: string): boolean {
  return postfixHeading.exec(line)?.[1] === designator;
}

/** How a line opens a provision: as a heading of its own, or with the text run on after it. */
type Opening = 'heading' | 'run-on';

/**
 * Whether `line` opens the provision `designator`, and how: as a heading of its own, or as the
 * first words of a paragraph where the law runs its text on in the heading's line ("SW 18.1. The
 * applicant", "ARTICULO 23.- Los"). A run-on line needs a dot, colon or dash after the number, and
 * a plain number needs a word for an article before it, so "Note 1: The" and "§ 5 Abs. 2 gilt" cite
 * and do not open.
 */
function opensProvision(line: string, designator: string): Opening | undefined {
  if (opensWithPostfixWord(line, designator)) return 'heading';
  if (!headsProvision(line, designator)) return undefined;
  if (headingLike(line)) return 'heading';
  const rest = line.slice(line.indexOf(designator) + designator.length);
  const runsOn =
    runOnRest.test(rest) && (!plainDesignator.test(designator) || articleWord.test(line));
  return runsOn ? 'run-on' : undefined;
}

/**
 * The article a paragraph or letter designator ("61.3", "61.2 b", "38 b") belongs to, looked for
 * when the paragraph itself heads no line, as a law that numbers paragraphs within each article
 * writes it.
 */
function articleOf(designator: string): string | undefined {
  return /^(\d+)(?:\.\d| [a-z]$)/u.exec(designator)?.[1];
}

/**
 * The passages of a page with a line that opens a provision the titles name, best first: the last
 * `maxPassagesPerProvision` for each, last first, the provisions taking turns. The article a source
 * cites is found by its number, whatever a passage locator picks; a few closed lists of words
 * (`postfixWord`, `articleWord`) only add the forms some languages write, and never remove a pick.
 */
export function provisionPassages(
  text: string,
  passages: readonly Passage[],
  titles: readonly string[],
): number[] {
  const designators = [...new Set(titles.flatMap(namedProvisions))];
  if (designators.length === 0) return [];
  const articles = designators.flatMap((designator) => articleOf(designator) ?? []);
  const sought = [...new Set([...designators, ...articles])];
  const headings = new Map<string, number[]>(sought.map((designator) => [designator, []]));
  const runOns = new Map<string, number[]>(sought.map((designator) => [designator, []]));
  passages.forEach(({ start, end }, index) => {
    for (const line of text.slice(start, end).split('\n')) {
      for (const designator of sought) {
        const opening = opensProvision(line, designator);
        if (opening === undefined) continue;
        const hits = (opening === 'heading' ? headings : runOns).get(designator) ?? [];
        if (hits.at(-1) !== index) hits.push(index);
      }
    }
  });
  // A heading line of its own outranks a line the text runs on in, so a later paragraph that
  // happens to open with the same number never crowds the heading out.
  const hitsOf = (designator: string) => {
    const own = headings.get(designator) ?? [];
    return own.length > 0 ? own : (runOns.get(designator) ?? []);
  };
  const found = designators.map((designator) => {
    const own = hitsOf(designator);
    const article = articleOf(designator);
    if (own.length > 0 || article === undefined) return own;
    // The article a paragraph belongs to counts only on a line that names it as an article.
    return hitsOf(article).filter((index) => {
      const { start, end } = passages[index] ?? { start: 0, end: 0 };
      return text
        .slice(start, end)
        .split('\n')
        .some((line) => articleWord.test(line) && opensProvision(line, article) !== undefined);
    });
  });
  const ranked = found.map((hits) => hits.slice(-maxPassagesPerProvision).reverse());
  const turns = Array.from({ length: maxPassagesPerProvision }, (_, turn) =>
    ranked.flatMap((hits) => hits.slice(turn, turn + 1)),
  );
  return [...new Set(turns.flat())];
}
