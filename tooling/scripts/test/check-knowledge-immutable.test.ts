import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { GitRepository } from '../src/git-tree.ts';

const run = promisify(execFile);
const script = join(import.meta.dirname, '../src/check-knowledge-immutable.ts');
const data = 'packages/knowledge/data';

async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd: dir });
  return stdout.trim();
}

async function repository(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'arca-immutable-'));
  await git(dir, 'init', '-q', '-b', 'main');
  await git(dir, 'config', 'user.email', 'test@example.invalid');
  await git(dir, 'config', 'user.name', 'Test');
  await git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

async function commit(dir: string, files: Record<string, string | null>): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) await rm(join(dir, path));
    else {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), content);
    }
  }
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '-q', '-m', 'change');
  return git(dir, 'rev-parse', 'HEAD');
}

async function check(dir: string, base: string, head: string) {
  return run('node', [script, dir, base, head]).then(
    ({ stdout, stderr }) => ({ code: 0, output: stdout + stderr }),
    (error: unknown) => {
      const failure = error as { code: number; stdout: string; stderr: string };
      return { code: failure.code, output: failure.stdout + failure.stderr };
    },
  );
}

describe('check-knowledge-immutable', () => {
  it('reads paths with tabs, newlines and quotes exactly', async () => {
    const dir = await repository();
    const name = `${data}/odd\tname\n"q".json`;
    const head = await commit(dir, { [name]: '{}' });
    const files = await new GitRepository(dir).files(head, [data]);
    expect([...files.keys()]).toEqual(['packages', 'packages/knowledge', data, name]);
    expect(files.get(name)?.mode).toBe('100644');
    expect(files.get(data)?.type).toBe('tree');
  });

  it('refuses a revision that is an option', async () => {
    const dir = await repository();
    await commit(dir, { 'a.txt': 'a' });
    await expect(new GitRepository(dir).commit('--output=/tmp/x')).rejects.toThrow();
  });

  it('fails a vendor directory that is a symbolic link to unapproved files', async () => {
    const dir = await repository();
    const base = await commit(dir, { [`${data}/countries/1.json`]: '{}' });
    await mkdir(join(dir, 'unapproved'));
    await writeFile(join(dir, 'unapproved/manifest.json'), '{}');
    await symlink('../../unapproved', join(dir, 'packages/knowledge/vendor'));
    const head = await commit(dir, {});
    expect(await check(dir, base, head)).toEqual({
      code: 1,
      output: 'packages/knowledge/vendor: must be a directory, not a link or a submodule\n',
    });
  });

  it('passes an append and fails an edit, from git history alone', async () => {
    const dir = await repository();
    const base = await commit(dir, {
      [`${data}/countries/1.json`]: '{"codes":["QM"]}',
      [`${data}/hashes.json`]: '{"schemaVersion":1,"vectors":[],"files":[]}',
    });
    const append = await commit(dir, {
      [`${data}/countries/2.json`]: '{"codes":["QM","QN"]}',
      [`${data}/hashes.json`]:
        '{"schemaVersion":1,"vectors":[],"files":[{"path":"countries/2.json","sha256":"1"}]}',
    });
    expect(await check(dir, base, append)).toEqual({ code: 0, output: '' });

    const edit = await commit(dir, {
      [`${data}/countries/1.json`]: '{"codes":["QN"]}',
      [`${data}/countries/2.json`]: null,
    });
    const result = await check(dir, append, edit);
    expect(result.code).toBe(1);
    expect(result.output.trim().split('\n')).toEqual([
      `${data}/countries/1.json: was modified; it is immutable, so add a new numbered file instead`,
      `${data}/countries/2.json: exists on the base branch and was deleted or renamed; it is immutable`,
    ]);
  });
});
