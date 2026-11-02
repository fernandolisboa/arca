import { execFileSync } from 'node:child_process';

export const objectId = /^[0-9a-f]{40}$/;

/** Runs git in `repo` with no pager, no external diff or text conversion, and quiet output. */
export function git(repo: string, args: readonly string[]): Buffer {
  return execFileSync(
    'git',
    ['-C', repo, '-c', 'core.quotePath=false', '-c', 'diff.external=', ...args],
    { maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

export function gitText(repo: string, args: readonly string[]): string {
  return git(repo, args).toString('utf8');
}

/** A blob's content as UTF-8; `object` is an object ID or a `<revision>:<path>` name. */
export function blobText(repo: string, object: string): string {
  return gitText(repo, ['cat-file', 'blob', object]);
}

/** Resolves a revision to a full commit ID. */
export function commitId(repo: string, revision: string): string {
  const id = gitText(repo, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${revision}^{commit}`,
  ]).trim();
  if (!objectId.test(id)) throw new Error(`could not resolve ${revision}`);
  return id;
}

export interface TreeEntry {
  readonly mode: string;
  readonly type: string;
  readonly object: string;
  readonly path: string;
}

/** Every entry of a commit's tree, recursively, with paths as git stores them. */
export function treeEntries(
  repo: string,
  commit: string,
  paths: readonly string[] = [],
): TreeEntry[] {
  const output = gitText(repo, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', ...paths]);
  return output
    .split('\0')
    .filter((record) => record !== '')
    .map((record) => {
      const tab = record.indexOf('\t');
      const [mode = '', type = '', object = ''] = record.slice(0, tab).split(' ');
      return { mode, type, object, path: record.slice(tab + 1) };
    });
}
