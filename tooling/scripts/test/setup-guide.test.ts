import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rootDir = fileURLToPath(new URL('../../..', import.meta.url));
const scanned = ['apps', 'packages', 'tooling'];
const skipped = new Set([
  'node_modules',
  'dist',
  'dev-dist',
  '.nitro',
  '.output',
  '.vercel',
  '.turbo',
  'test',
  'fixtures',
  'test-results',
  'playwright-report',
]);

const variableRead =
  /(?:process\.env|\benv)[?!]?(?:\??\.([A-Z][A-Z0-9_]+)|\??\.?\[\s*['"`]([A-Z][A-Z0-9_]+)['"`]\s*\])|requiredVariable\(\s*\w+,\s*['"`]([A-Z][A-Z0-9_]+)['"`]/g;
const secretLike = /SECRET|PASSWORD|TOKEN|_KEY$|^BLOB_/;

async function sources(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sources(path)));
    else if (/\.(?:[cm]?ts|tsx|[cm]?js)$/.test(entry.name)) found.push(path);
  }
  return found;
}

async function secretNamesReadByCode(): Promise<Set<string>> {
  const names = new Set<string>();
  for (const top of scanned) {
    for (const file of await sources(join(rootDir, top))) {
      for (const match of (await readFile(file, 'utf8')).matchAll(variableRead)) {
        const name = match[1] ?? match[2] ?? match[3];
        if (name !== undefined && secretLike.test(name)) names.add(name);
      }
    }
  }
  return names;
}

describe('docs/SETUP.md (#124)', () => {
  it('lists every secret-like variable the code reads', async () => {
    const guide = await readFile(join(rootDir, 'docs/SETUP.md'), 'utf8');
    const missing = [...(await secretNamesReadByCode())].filter(
      (name) => !guide.includes(`\`${name}\``),
    );
    expect(missing, 'add each to docs/SETUP.md in the same change').toEqual([]);
  });

  it('finds the variables it is meant to guard', async () => {
    const names = await secretNamesReadByCode();
    expect(names).toContain('BETTER_AUTH_SECRET');
    expect(names).toContain('ARCA_DB_API_PASSWORD');
    expect(names).toContain('ARCA_DB_MIGRATOR_PASSWORD');
    expect(names).toContain('BLOB_STORE_ID');
  });
});
