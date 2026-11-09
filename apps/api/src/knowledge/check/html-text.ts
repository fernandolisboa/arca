import { type DefaultTreeAdapterTypes, parse } from 'parse5';

type Node = DefaultTreeAdapterTypes.Node;

/** Elements whose content is never page text: code, styling, metadata and inert templates. */
const dropped = new Set(['head', 'script', 'style', 'noscript', 'template', 'iframe', 'object']);

/**
 * Elements a law marks superseded wording with. A consolidated text often keeps the old words
 * struck through beside the new ones, and a reader takes only the new ones as the law.
 */
const struck = new Set(['del', 's', 'strike']);

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
  'td',
  'th',
  'tr',
  'ul',
]);

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
 * A page's text as a reader sees it (ADR-0027): parsed by parse5, a parser with no scripts, no
 * network and no DOM emulation, then walked without recursion, so a deeply nested page cannot
 * overflow the stack. Scripts, styles, templates, comments, hidden elements and struck-through
 * text are dropped; block elements break lines; whitespace collapses within each line.
 */
export function htmlToText(html: string): string {
  const parts: string[] = [];
  const stack: (Node | '\n')[] = [parse(html)];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    if (next === '\n') {
      parts.push('\n');
      continue;
    }
    if (next.nodeName === '#text' && 'value' in next) {
      parts.push(next.value);
      continue;
    }
    if (!('childNodes' in next)) continue;
    if ('tagName' in next) {
      if (dropped.has(next.tagName) || struck.has(next.tagName) || hidden(next.attrs)) continue;
      if (blocks.has(next.tagName)) {
        parts.push('\n');
        stack.push('\n');
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
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}
