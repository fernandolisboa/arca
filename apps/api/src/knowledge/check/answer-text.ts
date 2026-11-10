import { htmlToText } from './html-text.js';

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

/** A string of data as a reader sees it: markup in it read as a page's markup is. */
function stringText(value: string): string {
  return /[<&]/u.test(value) ? htmlToText(value) : value.trim();
}

/**
 * Every string value of a JSON document, in the order the parser gives them; keys, numbers and
 * literals are structure. Walked without recursion, so a deeply nested answer cannot overflow the
 * stack. An answer that does not parse has no strings.
 */
export function jsonStrings(json: string): string[] {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    return [];
  }
  const strings: string[] = [];
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const next = stack.pop();
    if (typeof next === 'string') strings.push(next);
    else if (typeof next === 'object' && next !== null) {
      const children = Array.isArray(next) ? next : Object.values(next);
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
    }
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

/**
 * The text nodes and CDATA sections of an XML document, in document order, with references
 * decoded. Tags, comments, processing instructions and the document type are structure. One pass
 * over the text, with no parser that fetches, validates or expands anything.
 */
export function xmlStrings(xml: string): string[] {
  const strings: string[] = [];
  let index = 0;
  while (index < xml.length) {
    const open = xml.indexOf('<', index);
    const textEnd = open === -1 ? xml.length : open;
    if (textEnd > index) strings.push(decodeReferences(xml.slice(index, textEnd)));
    if (open === -1) break;
    if (xml.startsWith('<![CDATA[', open)) {
      const close = xml.indexOf(']]>', open);
      strings.push(xml.slice(open + 9, close === -1 ? xml.length : close));
      index = close === -1 ? xml.length : close + 3;
    } else if (xml.startsWith('<!--', open)) {
      index = after(xml, open + 4, '-->');
    } else if (xml.startsWith('<?', open)) {
      index = after(xml, open + 2, '?>');
    } else {
      index = markupEnd(xml, open);
    }
  }
  return strings;
}

/**
 * An answer's text as a reader sees it (ADR-0027). A page's markup through `htmlToText`; plain text
 * as it is; a JSON or XML answer as its strings in document order, one to a line, each with any
 * markup in it read as a page's markup is. Nothing in a data answer is ever more than text.
 */
export function answerText(format: AnswerFormat, body: string): string {
  switch (format) {
    case 'html':
      return htmlToText(body);
    case 'plain':
      return body;
    case 'json':
    case 'xml':
      return (format === 'json' ? jsonStrings(body) : xmlStrings(body))
        .map(stringText)
        .filter((text) => text !== '')
        .join('\n');
  }
}
