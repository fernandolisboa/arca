import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  classifyRegions,
  cldr,
  excludedRegions,
  reclassification,
  regionCodes,
} from '../scripts/countries.ts';
import { countriesFileSchema } from '../scripts/files.ts';
import { generateCountries } from '../scripts/generate-countries.ts';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const vendorDir = join(packageDir, 'vendor', 'cldr', cldr.release);
const repositoryRoot = join(packageDir, '..', '..');

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8')) as unknown;
const territories = (codes: readonly string[]): unknown => ({
  main: {
    en: {
      localeDisplayNames: { territories: Object.fromEntries(codes.map((code) => [code, code])) },
    },
  },
});

/** A package directory holding only the vendored release, to generate into. */
async function scratchPackage(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'arca-countries-'));
  await cp(vendorDir, join(dir, 'vendor', 'cldr', cldr.release), { recursive: true });
  return dir;
}

describe('the vendored CLDR release', () => {
  it('hashes to the approved entry, the manifest, the generator pins and the countries file', async () => {
    const [bytes, license, manifest, policy, countries] = await Promise.all([
      readFile(join(vendorDir, 'territories.json')),
      readFile(join(vendorDir, 'LICENSE')),
      readJson(join(vendorDir, 'manifest.json')),
      readJson(join(repositoryRoot, '.github', 'policy', 'vendored.json')),
      readJson(join(packageDir, 'data', 'countries', '1.json')),
    ]);
    const approved = (policy as { entries: Record<string, unknown>[] }).entries.find(
      (entry) => entry['repository'] === 'unicode-org/cldr-json' && entry['tag'] === cldr.release,
    );
    expect(approved).toEqual(manifest);
    expect(sha256(bytes)).toBe(cldr.sha256);
    expect(sha256(license)).toBe(cldr.licenseSha256);
    expect(approved).toMatchObject({ sha256: cldr.sha256, licenseSha256: cldr.licenseSha256 });
    expect(countriesFileSchema.parse(countries).cldr).toEqual({
      release: cldr.release,
      sha256: cldr.sha256,
      license: 'Unicode-3.0',
      licenseSha256: cldr.licenseSha256,
    });
  });
});

describe('classifyRegions', () => {
  it.each([
    ['a numeric macro-region', '150'],
    ['a grouping', 'EU'],
    ['a pseudo-region', 'XA'],
    ['Outlying Oceania', 'QO'],
    ['the unknown region', 'ZZ'],
    ['an exceptionally reserved code', 'CQ'],
  ])('excludes %s', (_, code) => {
    expect(classifyRegions([code], undefined)).toEqual({
      included: [],
      unclassified: [],
      removed: [],
    });
  });

  it('includes Kosovo', () => {
    expect(classifyRegions(['XK'], undefined).included).toEqual(['XK']);
  });

  it('holds back a code the previous file does not have, and sorts', () => {
    expect(classifyRegions(['FR', 'BR', 'NQ', 'EU'], ['FR', 'BR'])).toEqual({
      included: ['BR', 'FR'],
      unclassified: ['NQ'],
      removed: [],
    });
  });

  it('reports a code of the previous file the release drops', () => {
    expect(classifyRegions(['FR'], ['BR', 'FR']).removed).toEqual(['BR']);
  });

  it('applies reviewed admissions and withdrawals', () => {
    const reviewed = { admitted: new Set(['NQ']), withdrawn: new Set(['BR']) };
    expect(classifyRegions(['FR', 'NQ'], ['BR', 'FR'], reviewed)).toEqual({
      included: ['FR', 'NQ'],
      unclassified: [],
      removed: [],
    });
  });

  it('keeps the reviewed lists apart from the exclusions', () => {
    const { admitted, withdrawn } = reclassification;
    expect(
      [...admitted].filter((code) => excludedRegions.has(code) || withdrawn.has(code)),
    ).toEqual([]);
  });

  it('holds back a code that is not alpha-2', () => {
    expect(classifyRegions(['BRA'], undefined).unclassified).toEqual(['BRA']);
  });

  it('reads codes and drops display variants', () => {
    expect(regionCodes(territories(['GB', 'GB-alt-short', '001']))).toEqual(['GB', '001']);
    expect(() => regionCodes({})).toThrow();
  });
});

describe('generateCountries', () => {
  it('regenerates the committed countries file byte for byte', async () => {
    const dir = await scratchPackage();
    const committed = await readFile(join(packageDir, 'data', 'countries', '1.json'), 'utf8');
    expect(await generateCountries(dir)).toEqual({
      file: 'data/countries/1.json',
      content: committed,
    });
  });

  it('finds the committed file up to date', async () => {
    expect(await generateCountries(packageDir)).toBeUndefined();
  });

  it.each([
    [
      'adds a code no reviewed change classified',
      (codes: string[]) => codes.slice(1),
      /exclude these new region codes: AD/,
    ],
    [
      'drops a code without listing it as withdrawn',
      (codes: string[]) => [...codes, 'QM'],
      /Withdraw these dropped codes: QM/,
    ],
  ])('fails when a new release %s', async (_, previousCodes, problem) => {
    const dir = await scratchPackage();
    const first = await generateCountries(dir);
    if (first === undefined) throw new Error('Expected a first file');
    const file = JSON.parse(first.content) as { codes: string[] };
    file.codes = previousCodes(file.codes).sort();
    await mkdir(join(dir, 'data', 'countries'), { recursive: true });
    await writeFile(join(dir, 'data', 'countries', '1.json'), JSON.stringify(file));
    await expect(generateCountries(dir)).rejects.toThrow(problem);
  });

  it.each(['territories.json', 'LICENSE'])(
    'fails when the vendored %s does not match its pin',
    async (name) => {
      const dir = await scratchPackage();
      const path = join(dir, 'vendor', 'cldr', cldr.release, name);
      await writeFile(path, `${await readFile(path, 'utf8')} `);
      await expect(generateCountries(dir)).rejects.toThrow(/pinned SHA-256/);
    },
  );

  it('fails when the manifest names another tag', async () => {
    const dir = await scratchPackage();
    const path = join(dir, 'vendor', 'cldr', cldr.release, 'manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    await writeFile(path, JSON.stringify({ ...manifest, tag: '48.0.0' }));
    await expect(generateCountries(dir)).rejects.toThrow(/another tag/);
  });
});
