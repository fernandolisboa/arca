import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { maxKnowledgeJsonDepth } from '@arca/domain';
import { type Json, JsonSubsetError, parseJsonSubset } from './json.ts';

/** A problem found in the knowledge data, by file and JSON pointer. */
export interface Issue {
  readonly file: string;
  readonly path?: string;
  readonly message: string;
}

/** The kinds of versioned files, named as their directories under `data`. */
export type FileKind =
  'countries' | 'former-countries' | 'official-domains' | 'country-sets' | 'routes';

/** A versioned file as read from disk: where it is, what its path says it is, and its JSON. */
export interface RawFile {
  /** Path under `data`, with forward slashes. */
  readonly file: string;
  readonly kind: FileKind;
  readonly id: string;
  readonly number: number;
  readonly json: Json;
}

export interface RawData {
  readonly files: readonly RawFile[];
  /** Path under `data` of each version's table-driven cases (spec 0002, R8). */
  readonly cases: readonly string[];
  readonly hashes: Json | undefined;
  readonly issues: readonly Issue[];
}

const maxFileBytes = 1024 * 1024;
const numberPart = '([1-9][0-9]{0,5})';
const idPart = '([a-z0-9][a-z0-9-]{0,63})';
const layouts: readonly { kind: FileKind; pattern: RegExp; fixedId?: string }[] = [
  {
    kind: 'countries',
    pattern: new RegExp(`^countries/${numberPart}\\.json$`),
    fixedId: 'countries',
  },
  {
    kind: 'former-countries',
    pattern: new RegExp(`^former-countries/${numberPart}\\.json$`),
    fixedId: 'former-countries',
  },
  {
    kind: 'official-domains',
    pattern: new RegExp(`^official-domains/${idPart}/${numberPart}\\.json$`),
  },
  { kind: 'country-sets', pattern: new RegExp(`^country-sets/${idPart}/${numberPart}\\.json$`) },
  { kind: 'routes', pattern: new RegExp(`^routes/${idPart}/${numberPart}\\.json$`) },
];
const casesPattern = new RegExp(`^routes/${idPart}/${numberPart}\\.cases\\.json$`);
const hashesFile = 'hashes.json';
const notRegular = 'Only regular files belong in data';

/**
 * Reads every file under the data directory. Each must sit where the layout of spec 0002 puts it,
 * be a regular file and parse in the accepted JSON subset; anything else is an issue, so nothing
 * in `data` goes unchecked.
 */
export async function loadData(dataDir: string): Promise<RawData> {
  const files: RawFile[] = [];
  const cases: string[] = [];
  const issues: Issue[] = [];
  let hashes: Json | undefined;

  const entries = await readdir(dataDir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    const absolute = join(entry.parentPath, entry.name);
    const file = relative(dataDir, absolute).split(sep).join('/');
    if (!entry.isFile()) {
      issues.push({ file, message: notRegular });
      continue;
    }
    if (casesPattern.test(file)) {
      cases.push(file);
      continue;
    }
    const placed = place(file);
    if (placed === undefined && file !== hashesFile) {
      issues.push({ file, message: 'The file is not where the knowledge layout puts any file' });
      continue;
    }
    const json = await readJson(absolute, file, issues);
    if (json === undefined) continue;
    if (placed === undefined) hashes = json;
    else files.push({ file, json, ...placed });
  }
  files.sort((left, right) => left.file.localeCompare(right.file, 'en'));
  return { files, cases: cases.sort(), hashes, issues };
}

function place(file: string): Omit<RawFile, 'file' | 'json'> | undefined {
  for (const { kind, pattern, fixedId } of layouts) {
    const match = pattern.exec(file);
    if (match === null) continue;
    const [, first = '', second] = match;
    return fixedId === undefined
      ? { kind, id: first, number: Number(second) }
      : { kind, id: fixedId, number: Number(first) };
  }
  return undefined;
}

async function readJson(
  absolute: string,
  file: string,
  issues: Issue[],
): Promise<Json | undefined> {
  const bytes = await readBounded(absolute);
  if (bytes === undefined) {
    issues.push({ file, message: notRegular });
    return undefined;
  }
  if (bytes.length > maxFileBytes) {
    issues.push({ file, message: `A knowledge file is at most ${String(maxFileBytes)} bytes` });
    return undefined;
  }
  try {
    return parseJsonSubset(bytes, maxKnowledgeJsonDepth);
  } catch (error) {
    if (!(error instanceof JsonSubsetError)) throw error;
    issues.push({ file, message: error.message });
    return undefined;
  }
}

/**
 * Checks and reads through one handle opened without following a symbolic link, so the file read is
 * the file checked even if the path is swapped in between; non-blocking so a swapped-in pipe cannot
 * hang the build. Reads at most one byte past the limit.
 */
async function readBounded(absolute: string): Promise<Buffer | undefined> {
  let handle;
  try {
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (isErrorCode(error, 'ELOOP')) return undefined;
    throw error;
  }
  try {
    if (!(await handle.stat()).isFile()) return undefined;
    const buffer = Buffer.alloc(maxFileBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
