import { type DefaultTreeAdapterTypes, defaultTreeAdapter, parse } from 'parse5';

type Node = DefaultTreeAdapterTypes.Node;

/** Elements whose content is never page text: code, styling, metadata and inert templates. */
const dropped = new Set(['head', 'script', 'style', 'noscript', 'template', 'iframe', 'object']);

/**
 * Elements a law marks superseded wording with. A consolidated text often keeps the old words
 * struck through beside the new ones, and a reader takes only the new ones as the law.
 */
export const struckElements: ReadonlySet<string> = new Set(['del', 's', 'strike']);

const struckStyle = /(?:^|;)\s*text-decoration(?:-line)?\s*:[^;]*\bline-through\b/i;

/** Elements that start a new line, so the words on either side never run together. */
const blocks = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'caption',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tr',
  'ul',
]);

/**
 * The cells of a table row stay on the row's line, so a row reads as the one statement it is:
 * what a fee is for and the fee, side by side. A bar stands between them, not a space, so the
 * digits of two cells never read as one number.
 */
const cells = new Set(['td', 'th']);
const cellEnd = '\u001F';
const cellBar = ' | ';

/** A line with its whitespace collapsed and a bar between the cells that have text. */
const lineText = (line: string) =>
  line
    .split(cellEnd)
    .map((cell) => cell.replace(/\s+/gu, ' ').trim())
    .filter((cell) => cell !== '')
    .join(cellBar);

const hiddenStyle =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0*(?:\.0*)?|font-size\s*:\s*0*(?:\.0*)?(?:px|pt|em|rem|%)?|color\s*:\s*transparent)\s*(?:!important\s*)?(?:;|$)/i;

/**
 * Hidden from a reader by the element itself: the `hidden` attribute, `aria-hidden="true"` or an
 * inline style (no display, no visibility, no opacity, no size or a transparent color). Text a
 * style sheet hides stays in, and the value check in code covers it. Text the element's own style
 * strikes through is left out the same way.
 */
function hidden(attrs: readonly { readonly name: string; readonly value: string }[]): boolean {
  return attrs.some(
    ({ name, value }) =>
      name === 'hidden' ||
      (name === 'aria-hidden' && value.trim().toLowerCase() === 'true') ||
      (name === 'style' && (hiddenStyle.test(value) || struckStyle.test(value))),
  );
}

/**
 * The deepest nesting a page is read at, the depth browsers stop nesting at themselves. The
 * parser's work on each tag grows with the open elements above it, so markup nested without limit
 * would hold the step for hours within the size cap; no law page comes near this depth.
 */
export const maxElementDepth = 512;

class TooDeep extends Error {}

/** The parsed page, or undefined when its elements nest deeper than the limit. */
function parsed(html: string): Node | undefined {
  let depth = 0;
  const treeAdapter: typeof defaultTreeAdapter = {
    ...defaultTreeAdapter,
    onItemPush: () => {
      depth += 1;
      if (depth > maxElementDepth) throw new TooDeep();
    },
    onItemPop: () => {
      depth -= 1;
    },
  };
  try {
    return parse(html, { treeAdapter });
  } catch (error) {
    if (error instanceof TooDeep) return undefined;
    throw error;
  }
}

/**
 * A page's text as a reader sees it (ADR-0027): parsed by parse5, a parser with no scripts, no
 * network and no DOM emulation, then walked without recursion, so a deeply nested page cannot
 * overflow the stack. Scripts, styles, templates, comments, hidden elements and struck-through
 * text are dropped; block elements break lines, and a table row is one line with a bar between its
 * cells; whitespace collapses within each line. A page nested past the depth limit has no text.
 */
export function htmlToText(html: string): string {
  const parts: string[] = [];
  const root = parsed(html);
  if (root === undefined) return '';
  const stack: (Node | '\n' | typeof cellEnd)[] = [root];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    if (next === '\n' || next === cellEnd) {
      parts.push(next);
      continue;
    }
    if (next.nodeName === '#text' && 'value' in next) {
      parts.push(next.value);
      continue;
    }
    if (!('childNodes' in next)) continue;
    if ('tagName' in next) {
      if (dropped.has(next.tagName) || struckElements.has(next.tagName) || hidden(next.attrs))
        continue;
      const around = blocks.has(next.tagName)
        ? '\n'
        : cells.has(next.tagName)
          ? cellEnd
          : undefined;
      if (around !== undefined) {
        parts.push(around);
        stack.push(around);
      }
    }
    for (let index = next.childNodes.length - 1; index >= 0; index -= 1) {
      const child = next.childNodes[index];
      if (child !== undefined) stack.push(child);
    }
  }
  return parts
    .join('')
    .split('\n')
    .map(lineText)
    .filter((line) => line !== '')
    .join('\n');
}
