import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** A file in a git tree: its mode, object type and object ID, as `git ls-tree` prints them. */
export interface TreeFile {
  readonly mode: string;
  readonly type: string;
  readonly object: string;
}

const objectId = /^[0-9a-f]{40}$/;
/** Larger than any knowledge or vendored file may be; a bigger object fails the read. */
const maxObjectBytes = 4 * 1024 * 1024;

/** Reads commits of one repository as data: nothing from them is checked out or run. */
export class GitRepository {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  /** The commit a revision names, refusing anything that is not one. */
  async commit(revision: string): Promise<string> {
    const commit = (
      await this.#git(['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`])
    ).trim();
    if (!objectId.test(commit)) throw new Error(`${revision} does not name a commit`);
    return commit;
  }

  /** The merge base of two commits. */
  async mergeBase(left: string, right: string): Promise<string> {
    return (await this.#git(['merge-base', left, right])).trim();
  }

  /** Every file under the given paths of a commit, by path, read with NUL-separated output. */
  async files(commit: string, paths: readonly string[]): Promise<Map<string, TreeFile>> {
    const output = await this.#git(['ls-tree', '-r', '-z', '--full-tree', commit, '--', ...paths]);
    const files = new Map<string, TreeFile>();
    for (const record of output.split('\0')) {
      if (record === '') continue;
      const tab = record.indexOf('\t');
      const [mode = '', type = '', object = ''] = record.slice(0, tab).split(' ');
      files.set(record.slice(tab + 1), { mode, type, object });
    }
    return files;
  }

  /** The tree or blob ID at a path of a commit, or undefined when the path is absent. */
  async objectAt(commit: string, path: string): Promise<string | undefined> {
    const output = await this.#git(['ls-tree', '-z', '--full-tree', commit, '--', path]);
    const record = output.split('\0')[0] ?? '';
    return record === '' ? undefined : record.slice(0, record.indexOf('\t')).split(' ')[2];
  }

  /** A blob's bytes. */
  async blob(object: string): Promise<Buffer> {
    if (!objectId.test(object)) throw new Error(`${object} is not an object ID`);
    const { stdout } = await run('git', ['cat-file', 'blob', object], {
      cwd: this.#dir,
      encoding: 'buffer',
      maxBuffer: maxObjectBytes,
    });
    return stdout;
  }

  async #git(args: readonly string[]): Promise<string> {
    const { stdout } = await run('git', args, { cwd: this.#dir, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  }
}
