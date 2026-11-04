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

const fence = /^(?:```|~~~)/;
// Inline links and images, `[text](target "title")`; reference definitions, `[id]: target`.
const inlineLink = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const referenceLink = /^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/;
const external = /^[a-z][a-z0-9+.-]*:/i;

/** The anchor GitHub gives a heading: lowercased, punctuation dropped, spaces as hyphens. */
export function headingAnchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** The lines of a document outside fenced code. */
function proseLines(text: string): string[] {
  const lines: string[] = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (fence.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) lines.push(line);
  }
  return lines;
}

function anchorsOf(text: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const line of proseLines(text)) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)?.[1];
    if (heading === undefined) continue;
    const anchor = headingAnchor(heading);
    const count = seen.get(anchor) ?? 0;
    seen.set(anchor, count + 1);
    anchors.add(count === 0 ? anchor : `${anchor}-${String(count)}`);
  }
  return anchors;
}

function linksOf(text: string): string[] {
  return proseLines(text).flatMap((raw) => {
    // Inline code shows a link's syntax; it is not a link.
    const line = raw.replace(/`[^`]*`/g, '``');
    const reference = referenceLink.exec(line)?.[1];
    if (reference !== undefined) return [reference];
    return [...line.matchAll(inlineLink)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    );
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
      if (!anchorsIn(resolved, targetText).has(decodeURIComponent(anchor).toLowerCase())) {
        violations.push({ where: path, problem: `${link} names a heading that does not exist` });
      }
    }
  }
  return violations;
}

const run = promisify(execFile);

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const { stdout } = await run(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: rootDir,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const files = stdout.split('\0').filter((file) => file !== '');
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
