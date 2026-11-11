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
/** The most elements a page is read with; a law's longest consolidated text holds far fewer. */
export const maxElements = 500_000;
/**
 * The most work the parser may spend moving the pieces of everything one reader reads, a page or
 * the strings of a data answer: content out of a table it does not belong in, the children of
 * misnested formatting, the attributes of a repeated `html` or `body` tag. Each move goes through
 * the siblings or attributes beside it, which is what it costs here, so markup built to repeat
 * them would hold the step for minutes. A page whose one misnested element wraps ten thousand
 * paragraphs spends two fifths of this, and past it the parse takes seconds.
 */
export const maxMoveWork = 500_000_000;
/** An attribute costs the parser a set entry, many times a sibling it steps over. */
const attributeWork = 64;

/** What is left of a reader's move budget. */
interface MoveBudget {
  left: number;
}

class TooMuchMarkup extends Error {}

/**
 * The elements markup of this length may make: one for every three characters, the shortest tag,
 * and never more than the limit. A parser makes every unclosed formatting element again at each
 * new paragraph, so a few hundred of them make a short page cost gigabytes; this budget stops that
 * while it is still cheap.
 */
const elementBudget = (length: number) => Math.min(maxElements, Math.ceil(length / 3) + 16);

/**
 * The parsed page, or undefined when it nests deeper, makes more elements or moves more of its
 * content than the limits.
 */
function parsed(html: string, budget: MoveBudget): Node | undefined {
  let depth = 0;
  let elements = elementBudget(html.length);
  const moved = (through: number) => {
    budget.left -= through + 1;
    if (budget.left < 0) throw new TooMuchMarkup();
  };
  const treeAdapter: typeof defaultTreeAdapter = {
    ...defaultTreeAdapter,
    createElement: (...element) => {
      elements -= 1;
      if (elements < 0) throw new TooMuchMarkup();
      return defaultTreeAdapter.createElement(...element);
    },
    insertBefore: (parent, ...nodes) => {
      moved(parent.childNodes.length);
      defaultTreeAdapter.insertBefore(parent, ...nodes);
    },
    insertTextBefore: (parent, ...nodes) => {
      moved(parent.childNodes.length);
      defaultTreeAdapter.insertTextBefore(parent, ...nodes);
    },
    detachNode: (node) => {
      moved(node.parentNode?.childNodes.length ?? 0);
      defaultTreeAdapter.detachNode(node);
    },
    adoptAttributes: (recipient, attrs) => {
      moved(attributeWork * (recipient.attrs.length + attrs.length));
      defaultTreeAdapter.adoptAttributes(recipient, attrs);
    },
    onItemPush: () => {
      depth += 1;
      if (depth > maxElementDepth) throw new TooMuchMarkup();
    },
    onItemPop: () => {
      depth -= 1;
    },
  };
  try {
    return parse(html, { treeAdapter });
  } catch (error) {
    if (error instanceof TooMuchMarkup) return undefined;
    throw error;
  }
}

/**
 * Markup with a cell end wherever only tags stand between two digits, or a reference that may
 * write one, so a tag between two numbers never makes them one even when the parser drops it: a
 * cell with no table around it, an end tag that closes nothing. The tags are matched as written,
 * not parsed; the walk below keeps the digits of two text nodes apart for the tags it keeps.
 */
const digitsKeptApart = (html: string) =>
  html.replace(/((?:\d|;)\s*(?:<[^<>]*>\s*)+)(?=\d|&)/gu, `$1${cellEnd}`);

/**
 * A page's text as a reader sees it (ADR-0027): parsed by parse5, a parser with no scripts, no
 * network and no DOM emulation, then walked without recursion, so a deeply nested page cannot
 * overflow the stack. Scripts, styles, templates, comments, hidden elements and struck-through
 * text are dropped; block elements break lines, and a table row is one line with a bar between its
 * cells; whitespace collapses within each line; and a cell end stands between two text nodes whose
 * digits would meet, whatever is between them. Undefined for markup past a parsing limit.
 */
function textWithin(html: string, budget: MoveBudget): string | undefined {
  const parts: string[] = [];
  const root = parsed(digitsKeptApart(html), budget);
  if (root === undefined) return undefined;
  const stack: (Node | '\n' | typeof cellEnd)[] = [root];
  let afterDigit = false;
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    if (next === '\n' || next === cellEnd) {
      parts.push(next);
      continue;
    }
    if (next.nodeName === '#text' && 'value' in next) {
      if (afterDigit && /^\s*\d/u.test(next.value)) parts.push(cellEnd);
      if (next.value.trim() !== '') afterDigit = /\d\s*$/u.test(next.value);
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

/** A reader of markup with one move budget for all it reads: the strings of one data answer. */
export interface MarkupReader {
  /** The text of a piece of markup, none when it is past a parsing limit. */
  readonly read: (html: string) => string;
  /**
   * Whether a piece was past a limit. What the reader read is then not all the answer says, and a
   * piece left out may be the one that amends another, so the answer as a whole has no text.
   */
  readonly stopped: () => boolean;
}

export function markupReader(moveWork = maxMoveWork): MarkupReader {
  const budget = { left: moveWork };
  let stopped = false;
  return {
    read: (html) => {
      const text = textWithin(html, budget);
      stopped ||= text === undefined;
      return text ?? '';
    },
    stopped: () => stopped,
  };
}

/** The text of one page or one piece of markup, none when it is past a parsing limit. */
export const htmlToText = (html: string): string => markupReader().read(html);
