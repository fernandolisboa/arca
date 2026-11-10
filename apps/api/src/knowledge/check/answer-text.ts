import { htmlToText, struckElements } from './html-text.js';

/** How the fetcher reads an answer, by its media type. */
export type AnswerFormat = 'html' | 'plain' | 'json' | 'xml';

const htmlTypes = new Set(['text/html', 'application/xhtml+xml']);
const xmlTypes = new Set(['application/xml', 'text/xml']);

/** The format of a media type the check reads, or undefined for one it does not, such as a PDF. */
export function answerFormat(type: string): AnswerFormat | undefined {
  if (htmlTypes.has(type)) return 'html';
  if (type === 'text/plain') return 'plain';
  if (type === 'application/json' || /^application\/[\w.-]+\+json$/u.test(type)) return 'json';
  if (xmlTypes.has(type) || /^application\/[\w.-]+\+xml$/u.test(type)) return 'xml';
  return undefined;
}

/**
 * Whether a string of data holds markup of its own: a tag, or an entity or character reference. A
 * lone `<` or `&`, as in "income < minimum", is text.
 */
const hasMarkup = (value: string) =>
  /<\/?[a-z][a-z0-9:-]*(?:\s[^<>]*)?\/?>|&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/iu.test(value);

/** A string of data as a reader sees it: markup in it read as a page's markup is. */
function stringText(value: string): string {
  return hasMarkup(value) ? htmlToText(value) : value;
}

/** A JSON string token. Its two branches never match the same character, so it cannot backtrack. */
const jsonStringToken = /"(?:[^"\\]|\\.)*"/gu;
const jsonWhitespace = new Set([' ', '\t', '\n', '\r']);

/**
 * Every string value of a JSON document, in document order; keys, numbers and literals are
 * structure. The document is parsed once, only to know it is JSON: in a valid document a quote
 * outside a string opens one, so its string tokens are then read off the text itself, which keeps
 * the order the parser's objects would lose and never recurses. An answer that does not parse has
 * no strings.
 */
export function jsonStrings(json: string): string[] {
  try {
    JSON.parse(json);
  } catch {
    return [];
  }
  const strings: string[] = [];
  for (const token of json.matchAll(jsonStringToken)) {
    let after = token.index + token[0].length;
    while (jsonWhitespace.has(json.charAt(after))) after += 1;
    if (json.charAt(after) !== ':') strings.push(JSON.parse(token[0]) as string);
  }
  return strings;
}

const predefined: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * XML's five predefined entities and its character references. Any other entity is left as
 * written: a document type is never read, so no entity it declares is ever expanded.
 */
function decodeReferences(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,4});/giu, (whole, name: string) => {
    if (!name.startsWith('#')) return predefined[name] ?? whole;
    const code =
      name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    const scalar = code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
    return scalar ? String.fromCodePoint(code) : whole;
  });
}

/**
 * Where the markup that opens at `from` ends: the index after its closing `>`, past any `>` inside
 * quotes or, for a document type, inside its bracketed internal subset; the end of the text when
 * it never closes.
 */
function markupEnd(xml: string, from: number): number {
  let quote: string | undefined;
  let depth = 0;
  for (let index = from + 1; index < xml.length; index += 1) {
    const char = xml.charAt(index);
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '[') depth += 1;
    else if (char === ']') depth = Math.max(0, depth - 1);
    else if (char === '>' && depth === 0) return index + 1;
  }
  return xml.length;
}

/** The index after `close` once it appears at or after `from`, or the end of the text. */
function after(xml: string, from: number, close: string): number {
  const found = xml.indexOf(close, from);
  return found === -1 ? xml.length : found + close.length;
}

/** An element tag's local name, lower case, whether it closes its element, and whether it is empty. */
function tagOf(tag: string): {
  readonly name: string;
  readonly end: boolean;
  readonly empty: boolean;
} {
  const end = tag.startsWith('</');
  const name = /^[^\s/>]*/u.exec(tag.slice(end ? 2 : 1))?.[0] ?? '';
  return {
    name: name.slice(name.lastIndexOf(':') + 1).toLowerCase(),
    end,
    empty: tag.endsWith('/>'),
  };
}

/**
 * The text of an XML document as a reader of its text would see it: its text nodes and CDATA
 * sections in document order, with references decoded. Tags, attributes, comments, processing
 * instructions and the document type are structure, and the text of an element a law strikes
 * superseded wording with is left out, as on a page. No vocabulary says which elements start a
 * line, so the document's own line breaks stand, text that follows two or more tags starts a new
 * line, and text that follows one tag runs on, as words in an inline element do. One pass over the
 * text, with no parser that fetches, validates or expands anything.
 */
export function xmlText(xml: string): string {
  const pieces: string[] = [];
  let tagsSinceText = 2;
  let struckDepth = 0;
  const text = (piece: string) => {
    if (struckDepth > 0) return;
    if (piece.trim() === '') pieces.push(piece);
    else {
      pieces.push(
        tagsSinceText >= 2 ? '\n' : '',
        hasMarkup(piece) ? `\n${htmlToText(piece)}\n` : piece,
      );
      tagsSinceText = 0;
    }
  };
  let index = 0;
  while (index < xml.length) {
    const open = xml.indexOf('<', index);
    const textEnd = open === -1 ? xml.length : open;
    if (textEnd > index) text(decodeReferences(xml.slice(index, textEnd)));
    if (open === -1) break;
    if (xml.startsWith('<![CDATA[', open)) {
      const close = xml.indexOf(']]>', open);
      text(xml.slice(open + 9, close === -1 ? xml.length : close));
      index = close === -1 ? xml.length : close + 3;
    } else if (xml.startsWith('<!--', open)) {
      index = after(xml, open + 4, '-->');
    } else if (xml.startsWith('<?', open)) {
      index = after(xml, open + 2, '?>');
    } else {
      index = markupEnd(xml, open);
      if (xml.startsWith('<!', open)) continue;
      const { name, end, empty } = tagOf(xml.slice(open, index));
      if (struckElements.has(name)) {
        if (end) struckDepth = Math.max(0, struckDepth - 1);
        else if (!empty) struckDepth += 1;
      }
      tagsSinceText += 1;
    }
  }
  return pieces.join('');
}

/** The texts of a data answer as lines: whitespace collapsed within each, the blank ones left out. */
function dataLines(texts: readonly string[]): string {
  return texts
    .flatMap((text) => text.split('\n'))
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * A line that starts with a digit after one that ends with a digit opens with a bar, as between
 * the cells of a table row, so the digits of two lines never read as one number: a quote takes a
 * line break as a space, and a space between digits is a thousands separator to the value check.
 */
function digitLinesApart(text: string): string {
  let afterDigit = false;
  return text
    .split('\n')
    .map((line) => {
      const words = line.trim();
      if (words === '') return line;
      const barred = afterDigit && /^\d/u.test(words);
      afterDigit = /\d$/u.test(words);
      return barred ? `| ${line}` : line;
    })
    .join('\n');
}

function textOf(format: AnswerFormat, body: string): string {
  switch (format) {
    case 'html':
      return htmlToText(body);
    case 'plain':
      return body;
    case 'json':
      return dataLines(jsonStrings(body).map(stringText));
    case 'xml':
      return dataLines([xmlText(body)]);
  }
}

/**
 * An answer's text as a reader sees it (ADR-0027). A page's markup through `htmlToText`; plain text
 * as it is; a JSON answer as its string values in document order, one to a line; an XML answer as
 * its text in document order. A string of either with markup in it is read as a page's markup is.
 * Nothing in a data answer is ever more than text, and in every format the digits of two lines
 * stay apart.
 */
export function answerText(format: AnswerFormat, body: string): string {
  return digitLinesApart(textOf(format, body));
}
