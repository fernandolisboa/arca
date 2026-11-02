import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checksum,
  pendingMigrations,
  readMigrations,
  type MigrationFile,
} from '../src/db/migrations.ts';

function file(name: string, sql = `SELECT '${name}'`): MigrationFile {
  return { name, sql, checksum: checksum(sql) };
}

const files = [file('20260101000000_a'), file('20260102000000_b'), file('20260103000000_c')];
const row = ({ name, checksum: sum }: MigrationFile) => ({ name, checksum: sum });

describe('pendingMigrations', () => {
  it('returns the files after the journal', () => {
    expect(pendingMigrations(files, [])).toEqual({ pending: files });
    expect(pendingMigrations(files, files.slice(0, 2).map(row))).toEqual({
      pending: files.slice(2),
    });
    expect(pendingMigrations(files, files.map(row))).toEqual({ pending: [] });
  });

  it('refuses a journal that is not an exact prefix', () => {
    const [a, b, c] = files.map(row);
    if (a === undefined || b === undefined || c === undefined) throw new Error('fixture');
    expect(pendingMigrations(files, [a, c])).toEqual({
      problem: 'journal row 2 is 20260103000000_c, not 20260102000000_b',
    });
    expect(pendingMigrations(files, [b])).toHaveProperty('problem');
    expect(pendingMigrations(files.slice(0, 1), [a, b])).toEqual({
      problem: 'the journal lists 2 migrations, more than on disk',
    });
  });

  it('refuses a file that changed after it was applied', () => {
    const [a] = files;
    if (a === undefined) throw new Error('fixture');
    expect(pendingMigrations(files, [{ name: a.name, checksum: checksum('other') }])).toEqual({
      problem: '20260101000000_a changed after it was applied',
    });
  });
});

describe('readMigrations', () => {
  it('reads migration folders in name order', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arca-migrations-'));
    for (const name of ['20260102000000_b', '20260101000000_a']) {
      await mkdir(join(dir, name));
      await writeFile(join(dir, name, 'migration.sql'), `SELECT '${name}'`);
    }
    expect(await readMigrations(dir)).toEqual([file('20260101000000_a'), file('20260102000000_b')]);
  });

  it('refuses a folder that is not <timestamp>_<name>', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arca-migrations-'));
    await mkdir(join(dir, 'later'));
    await expect(readMigrations(dir)).rejects.toThrow('migration folder later');
  });
});
