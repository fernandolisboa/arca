import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { blobText, git, gitText, treeEntries, type TreeEntry } from './git.ts';
import { parseAgentDefinition, type AgentDefinition } from './reviewers.ts';

/** Docs that carry instructions to the reviewers; never copied as reference data. */
export const instructionFiles = ['CLAUDE.md', 'docs/REVIEW.md', 'docs/SECURITY.md'] as const;
const agentsDir = '.claude/agents/';
const acceptancesFile = 'docs/review-acceptances.md';
const maxFileBytes = 512 * 1024;
const nestedInstructions = new Set(['CLAUDE.md', 'CLAUDE.local.md', '.claude']);

export class PrepareError extends Error {}

export function newNonce(): string {
  return randomBytes(16).toString('hex');
}

/** Wraps untrusted text in delimiters that carry the run's nonce, which the text cannot guess. */
export function wrapUntrusted(text: string, nonce: string): string {
  return `===== BEGIN UNTRUSTED DATA ${nonce} =====\n${text}${text.endsWith('\n') ? '' : '\n'}===== END UNTRUSTED DATA ${nonce} =====\n`;
}

export interface ChangedFile {
  readonly status: string;
  readonly path: string;
}

export interface PreparedInput {
  readonly nonce: string;
  readonly changed: readonly ChangedFile[];
  /** The change's agent definitions, parsed, when it touches `.claude/agents/`; else undefined. */
  readonly changedAgents: readonly AgentDefinition[] | undefined;
  /** docs/review-acceptances.md at the head commit, read by code only. */
  readonly acceptances: string;
}

/**
 * Writes `<out>/review-input/` for one change (spec 0001, R10): the diff, the changed paths, their
 * history (SHAs, dates and paths only) and the changed files under neutral names, so no path from
 * the change becomes a real path, plus the reference docs from `referenceRevision`. Every file is
 * wrapped as untrusted data. Fails when the head tree holds a symlink or a submodule.
 */
export async function prepareReviewInput(options: {
  readonly repo: string;
  readonly base: string;
  readonly head: string;
  readonly referenceRevision: string;
  readonly out: string;
  readonly nonce?: string;
}): Promise<PreparedInput> {
  const { repo, base, head, referenceRevision, out } = options;
  const nonce = options.nonce ?? newNonce();
  const headTree = treeEntries(repo, head);
  if (headTree.some((entry) => entry.mode === '120000')) {
    throw new PrepareError('the change contains a symbolic link');
  }
  if (headTree.some((entry) => entry.mode === '160000')) {
    throw new PrepareError('the change contains a submodule');
  }
  const blobs = new Map(headTree.map((entry) => [entry.path, entry]));
  const mergeBase = gitText(repo, ['merge-base', base, head]).trim();
  const changed = changedFiles(repo, mergeBase, head);

  const input = join(out, 'review-input');
  const write = async (path: string, text: string) => {
    await mkdir(dirname(join(input, path)), { recursive: true });
    await writeFile(join(input, path), wrapUntrusted(text, nonce));
  };

  const diff = gitText(repo, [
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    '--unified=5',
    mergeBase,
    head,
  ]);
  await write('diff.patch', diff);

  const map: string[] = [];
  for (const [index, file] of changed.entries()) {
    const name = `files/${String(index + 1)}.txt`;
    map.push(`${name}\t${file.status}\t${file.path}`);
    const blob = blobs.get(file.path);
    if (blob?.type === 'blob') await write(name, fileText(repo, blob));
  }
  await write('files.txt', `${map.join('\n')}\n`);

  const history = gitText(repo, [
    'log',
    '--no-renames',
    '--format=commit %H %cI',
    '--name-only',
    `${mergeBase}..${head}`,
  ]);
  await write('history.txt', history);

  for (const doc of referenceDocs(repo, referenceRevision)) {
    await write(join('reference', doc.path), blobText(repo, doc.object));
  }

  const touchesAgents = changed.some((file) => file.path.startsWith(agentsDir));
  const acceptances = blobs.get(acceptancesFile);
  return {
    nonce,
    changed,
    changedAgents: touchesAgents ? agentDefinitions(repo, headTree) : undefined,
    acceptances: acceptances === undefined ? '' : blobText(repo, acceptances.object),
  };
}

function changedFiles(repo: string, from: string, to: string): ChangedFile[] {
  const fields = gitText(repo, ['diff', '-z', '--name-status', '--no-renames', from, to])
    .split('\0')
    .filter((field) => field !== '');
  const files: ChangedFile[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    files.push({ status: fields[index] ?? '', path: fields[index + 1] ?? '' });
  }
  return files;
}

function fileText(repo: string, blob: TreeEntry): string {
  const content = git(repo, ['cat-file', 'blob', blob.object]);
  if (content.subarray(0, 8000).includes(0)) return '(binary file, not included)\n';
  if (content.length <= maxFileBytes) return content.toString('utf8');
  return `${content.subarray(0, maxFileBytes).toString('utf8')}\n(cut at ${String(maxFileBytes)} bytes)\n`;
}

/**
 * README.md and the Markdown under docs/, except the files that carry instructions. Claude Code
 * loads any CLAUDE.md or `.claude/` it finds beside a file it reads, so none is copied.
 */
function referenceDocs(repo: string, revision: string): TreeEntry[] {
  const skipped = new Set<string>([...instructionFiles, acceptancesFile]);
  return treeEntries(repo, revision, ['README.md', 'docs/']).filter(
    (entry) =>
      entry.type === 'blob' &&
      entry.path.endsWith('.md') &&
      !skipped.has(entry.path) &&
      !entry.path.split('/').some((part) => nestedInstructions.has(part)),
  );
}

/** Parses every agent definition at the head commit; one that fails stops the run before a model. */
function agentDefinitions(repo: string, headTree: readonly TreeEntry[]): AgentDefinition[] {
  return headTree
    .filter((entry) => entry.path.startsWith(agentsDir) && entry.path.endsWith('.md'))
    .map((entry) => {
      try {
        return parseAgentDefinition(blobText(repo, entry.object));
      } catch (error) {
        throw new PrepareError(
          `the change's agent definition ${entry.path} ${(error as Error).message}`,
        );
      }
    });
}
