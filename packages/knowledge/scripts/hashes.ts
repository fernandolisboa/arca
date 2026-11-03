import { contentHash } from './canonical.ts';
import { hashesFileSchema } from './files.ts';
import type { Json } from './json.ts';
import type { Issue } from './load.ts';
import { rfc8785Vectors } from './vectors.ts';

const hashesFile = 'hashes.json';

/**
 * Compares the computed hashes with the committed ones (spec 0002, R6). Every vector and every valid
 * route version and country set has an entry with the same hash; a missing entry is reported with
 * the hash to append, and an entry for a file that does not exist is an issue too.
 */
export function checkHashes(
  recorded: Json | undefined,
  computed: ReadonlyMap<string, string>,
  existing: ReadonlySet<string>,
): Issue[] {
  if (recorded === undefined) return [];
  const parsed = hashesFileSchema.safeParse(recorded);
  if (!parsed.success) {
    return parsed.error.issues.map((problem) => ({
      file: hashesFile,
      path: `/${problem.path.map(String).join('/')}`,
      message: problem.message,
    }));
  }
  const issues: Issue[] = [];
  const issue = (message: string): void => {
    issues.push({ file: hashesFile, message });
  };
  const vectors = byKey(
    parsed.data.vectors.map((entry) => [entry.name, entry.sha256]),
    'vector',
    issue,
  );
  const files = byKey(
    parsed.data.files.map((entry) => [entry.path, entry.sha256]),
    'file',
    issue,
  );

  for (const vector of rfc8785Vectors) {
    compare(`vector ${vector.name}`, vectors.get(vector.name), contentHash(vector.value), issue);
  }
  for (const [path, hash] of computed) compare(path, files.get(path), hash, issue);
  for (const path of files.keys()) {
    if (!existing.has(path)) issue(`${path} has a recorded hash but no file`);
  }
  return issues;
}

function byKey(
  entries: readonly (readonly [string, string])[],
  what: string,
  issue: (message: string) => void,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, hash] of entries) {
    if (map.has(key)) issue(`The ${what} ${key} has more than one entry`);
    map.set(key, hash);
  }
  return map;
}

function compare(
  what: string,
  recorded: string | undefined,
  computed: string,
  issue: (message: string) => void,
): void {
  if (recorded === undefined) issue(`${what} has no recorded hash; append ${computed}`);
  else if (recorded !== computed) {
    issue(`${what} hashes to ${computed}, not the recorded ${recorded}`);
  }
}
