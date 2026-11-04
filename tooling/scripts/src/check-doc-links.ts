import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { promisify } from 'node:util';
import { reportViolations } from './report.ts';
import type { Violation } from './workspace.ts';

/** A Markdown file in the repository, by its path from the root. */
export interface Document {
  readonly path: string;
  readonly text: string;
}

export interface Repository {
  /** Every Markdown file, so a link into one can be checked down to its heading. */
  readonly documents: readonly Document[];
  /** Whether a path that is not a Markdown file exists (a file or a directory). */
  readonly exists: (path: string) => boolean;
}

const fenceOpen = /^ {0,3}(`{3,}|~{3,})/;
// The text of a link may hold one level of brackets, as a linked image does: `[![alt](i)](t)`.
const linkText = String.raw`\[(?:[^\[\]]|\[[^\]]*\])*\]`;
const linkTitle = String.raw`(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?`;
// Inline links and images, `[text](target "title")` or `[text](<target with spaces>)`.
const inlineLink = new RegExp(
  String.raw`!?${linkText}\(\s*(?:<([^>]*)>|([^)\s]+))${linkTitle}\s*\)`,
  'g',
);
const image = new RegExp(String.raw`!\[[^\]]*\]\(\s*(?:<([^>]*)>|([^)\s]+))${linkTitle}\s*\)`, 'g');
// Reference definitions, `[id]: target`; a footnote, `[^1]: text`, is not one.
const referenceLink = new RegExp(
  String.raw`^\s{0,3}\[(?!\^)[^\]]+\]:\s*<?(\S+?)>?${linkTitle}\s*$`,
);
const external = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The anchor GitHub gives a heading: lowercased, punctuation dropped, spaces as hyphens. An
 * approximation of github-slugger without the dependency; where it differs (HTML tags in a
 * heading, emphasis marks), a valid link is reported, never a broken one passed.
 */
export function headingAnchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/**
 * The lines of a document outside fenced code. A fence closes only on a run of its own character
 * at least as long as the one that opened it, with nothing after it.
 */
function proseLines(text: string): string[] {
  const lines: string[] = [];
  let open: string | undefined;
  for (const line of text.split('\n')) {
    const run = fenceOpen.exec(line)?.[1];
    if (open === undefined) {
      // A backtick fence's info string has no backtick; otherwise the line is inline code.
      if (
        run !== undefined &&
        !(run.startsWith('`') && line.trim().slice(run.length).includes('`'))
      ) {
        open = run;
        continue;
      }
      lines.push(line);
    } else if (
      run !== undefined &&
      run.startsWith(open.charAt(0)) &&
      run.length >= open.length &&
      line.trim() === run
    ) {
      open = undefined;
    }
  }
  return lines;
}

function anchorsOf(text: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const line of proseLines(text)) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)?.[1];
    if (heading === undefined) continue;
    const base = headingAnchor(heading);
    let anchor = base;
    let count = seen.get(base) ?? 0;
    while (anchors.has(anchor)) {
      count += 1;
      anchor = `${base}-${String(count)}`;
    }
    seen.set(base, count);
    anchors.add(anchor);
  }
  return anchors;
}

function linksOf(text: string): string[] {
  return proseLines(text).flatMap((raw) => {
    // Inline code shows a link's syntax; it is not a link.
    const line = raw.replace(/`[^`]*`/g, '``');
    const reference = referenceLink.exec(line)?.[1];
    if (reference !== undefined) return [reference];
    // A linked image holds two targets: the link's, and the image's inside its text.
    const targets = [...line.matchAll(inlineLink), ...line.matchAll(image)].flatMap((match) => {
      const target = match[1] ?? match[2];
      return target === undefined ? [] : [target];
    });
    return [...new Set(targets)];
  });
}

/**
 * Every relative link in the repository's Markdown resolves to a file, a directory or a heading
 * (spec 0004, R11). Links to other sites are not fetched, so CI stays deterministic; they are
 * checked by hand when written.
 */
export function checkDocLinks({ documents, exists }: Repository): Violation[] {
  const byPath = new Map(documents.map((document) => [document.path, document.text]));
  const anchors = new Map<string, Set<string>>();
  const anchorsIn = (path: string, text: string) => {
    const known = anchors.get(path) ?? anchorsOf(text);
    anchors.set(path, known);
    return known;
  };
  const violations: Violation[] = [];
  for (const { path, text } of documents) {
    for (const link of linksOf(text)) {
      if (external.test(link)) continue;
      const [target = '', anchor] = link.split('#', 2);
      let resolved = path;
      if (target !== '') {
        let decoded: string;
        try {
          decoded = decodeURIComponent(target);
        } catch {
          violations.push({ where: path, problem: `${link} is not a valid link` });
          continue;
        }
        resolved = normalize(join(dirname(path), decoded)).replace(/\/$/, '');
        if (resolved.startsWith('..')) {
          violations.push({ where: path, problem: `${link} points outside the repository` });
          continue;
        }
      }
      const targetText = byPath.get(resolved);
      if (targetText === undefined && !exists(resolved)) {
        violations.push({ where: path, problem: `${link} does not exist` });
        continue;
      }
      if (anchor === undefined || anchor === '') continue;
      if (targetText === undefined) continue;
      let heading: string;
      try {
        heading = decodeURIComponent(anchor).toLowerCase();
      } catch {
        violations.push({ where: path, problem: `${link} is not a valid link` });
        continue;
      }
      if (!anchorsIn(resolved, targetText).has(heading)) {
        violations.push({ where: path, problem: `${link} names a heading that does not exist` });
      }
    }
  }
  return violations;
}

const run = promisify(execFile);

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const list = async (...args: string[]) =>
    (
      await run('git', ['ls-files', '-z', ...args], { cwd: rootDir, maxBuffer: 64 * 1024 * 1024 })
    ).stdout
      .split('\0')
      .filter((file) => file !== '');
  // Files deleted from the work tree but still in the index are gone for a reader too.
  const deleted = new Set(await list('--deleted'));
  const files = (await list('--cached', '--others', '--exclude-standard')).filter(
    (file) => !deleted.has(file),
  );
  const documents = await Promise.all(
    files
      .filter((file) => file.endsWith('.md'))
      .map(async (file) => ({ path: file, text: await readFile(join(rootDir, file), 'utf8') })),
  );
  const present = new Set(files);
  const directories = new Set(files.flatMap((file) => ancestors(file)));
  const exists = (path: string) => present.has(path) || directories.has(path);
  reportViolations(checkDocLinks({ documents, exists }));
}

function ancestors(file: string): string[] {
  const parts = file.split('/').slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

if (import.meta.main) await main();
