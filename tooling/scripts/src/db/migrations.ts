import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface MigrationFile {
  /** The folder name, as drizzle-kit writes it: `<timestamp>_<name>`. */
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface JournalRow {
  readonly name: string;
  readonly checksum: string;
}

const migrationName = /^\d{14}_[a-z0-9_]+$/;

export function checksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/** Reads `<dir>/<name>/migration.sql` for every migration folder, in name order. */
export async function readMigrations(dir: string): Promise<MigrationFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const files: MigrationFile[] = [];
  for (const name of names) {
    if (!migrationName.test(name))
      throw new Error(`migration folder ${name} is not <timestamp>_<name>`);
    const sql = await readFile(join(dir, name, 'migration.sql'), 'utf8');
    files.push({ name, sql, checksum: checksum(sql) });
  }
  return files;
}

/**
 * The migrations still to apply, or why none may run: the journal must be an exact prefix of the
 * files on disk, so a migration cannot mark a later one as applied and a file cannot change after it
 * ran.
 */
export function pendingMigrations(
  files: readonly MigrationFile[],
  journal: readonly JournalRow[],
): { pending: MigrationFile[] } | { problem: string } {
  if (journal.length > files.length) {
    return { problem: `the journal lists ${String(journal.length)} migrations, more than on disk` };
  }
  for (const [index, row] of journal.entries()) {
    const file = files[index];
    if (file?.name !== row.name) {
      return {
        problem: `journal row ${String(index + 1)} is ${row.name}, not ${String(file?.name)}`,
      };
    }
    if (file.checksum !== row.checksum)
      return { problem: `${row.name} changed after it was applied` };
  }
  return { pending: files.slice(journal.length) };
}
