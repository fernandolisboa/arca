import { addressTexts, digitsApart } from '@arca/domain';
import { htmlToText, markupReader, struckElements } from './html-text.js';

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
 * Whether a string of data holds markup of its own: a tag, a comment, or an entity or character
 * reference. A lone `<` or `&`, as in "income < minimum", is text.
 */
const hasMarkup = (value: string) =>
  /<\/?[a-z][a-z0-9:-]*(?:\s[^<>]*)?\/?>|<!--|&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/iu.test(value);

/** A string of data as a reader sees it: markup in it read as a page's markup is. */
const stringText = (read: (markup: string) => string) => (value: string) =>
  hasMarkup(value) ? read(value) : value;

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
 * line, so the document's own line breaks stand, text that follows two or more tags, or an empty
 * element, starts a new line, and text that follows one tag runs on, as words in an inline element
 * do, unless digits would meet across it: a tag between two numbers never makes them one. One pass
 * over the text, with no parser that fetches, validates or expands anything.
 */
export function xmlText(xml: string, read = markupReader()): string {
  const pieces: string[] = [];
  let tagsSinceText = 2;
  let afterDigit = false;
  let struckDepth = 0;
  const text = (piece: string) => {
    if (struckDepth > 0) return;
    if (piece.trim() === '') pieces.push(piece);
    else {
      const digitsMeet = tagsSinceText > 0 && afterDigit && /^\s*\d/u.test(piece);
      pieces.push(
        tagsSinceText >= 2 || digitsMeet ? '\n' : '',
        hasMarkup(piece) ? `\n${read(piece)}\n` : piece,
      );
      tagsSinceText = 0;
      afterDigit = /\d\s*$/u.test(piece);
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
      tagsSinceText += empty ? 2 : 1;
    }
  }
  return pieces.join('');
}

/**
 * The texts of a data answer as lines: whitespace collapsed within each, once the digits of its
 * columns are apart, and the blank ones left out.
 */
function dataLines(texts: readonly string[]): string {
  return texts
    .flatMap((text) => digitsApart(text).split('\n'))
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

function textOf(format: AnswerFormat, body: string): string {
  switch (format) {
    case 'html':
      return htmlToText(body);
    case 'plain':
      return body;
    case 'json':
      return dataLines(jsonStrings(body).map(stringText(markupReader())));
    case 'xml':
      return dataLines([xmlText(body)]);
  }
}

/**
 * An answer's text as a reader sees it (ADR-0027). A page's markup through `htmlToText`; plain text
 * as it is; a JSON answer as its string values in document order, one to a line; an XML answer as
 * its text in document order. A string of either with markup in it is read as a page's markup is.
 * Nothing in a data answer is ever more than text. In every format, a NUL or an unpaired
 * surrogate, which a stored report cannot hold, reads as the replacement character, and the digits
 * of two lines stay apart.
 */
export function answerText(format: AnswerFormat, body: string): string {
  return digitsApart(textOf(format, body).replace(/\0|\p{Cs}/gu, '\uFFFD'));
}

/** A reader of markup decodes what it reads, and an XML answer's text twice over. */
const renderingRounds = 3;

/**
 * What the reader makes of the addresses of a chain when an answer writes one back: each decoded
 * as a server might, then read as a string of a data answer is, as often as that changes it. The
 * quote check compares a quote with these as with the addresses themselves, so a claim an address
 * spells as character references, or between tags, is still an echo of the address.
 */
export function addressesAsRead(chain: readonly string[]): string[] {
  const read = new Set<string>();
  for (const address of chain.flatMap((url) => addressTexts(url) ?? [])) {
    let text = address;
    for (let round = 0; round < renderingRounds; round += 1) {
      const next = htmlToText(text);
      if (next === text) break;
      read.add(next);
      text = next;
    }
  }
  return [...read];
}
