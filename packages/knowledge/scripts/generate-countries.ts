import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maxKnowledgeJsonDepth } from '@arca/domain';
import { parseJsonSubset } from '@arca/scripts/json';
import { classifyRegions, cldr, regionCodes } from './countries.ts';
import { type CountriesFile, countriesFileSchema } from './files.ts';

const territoriesFile = 'territories.json';
const licenseFile = 'LICENSE';
const countriesFilePattern = /^([1-9][0-9]{0,5})\.json$/;

export interface GeneratedCountries {
  /** Path under the package directory. */
  readonly file: string;
  readonly content: string;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The pinned CLDR file's bytes, after checking them and the license against the pins. */
async function readVendored(vendorDir: string): Promise<Uint8Array> {
  const [territories, license, manifest] = await Promise.all([
    readFile(join(vendorDir, territoriesFile)),
    readFile(join(vendorDir, licenseFile)),
    readFile(join(vendorDir, 'manifest.json'), 'utf8'),
  ]);
  const pinned = JSON.parse(manifest) as Record<string, unknown>;
  const mismatches = [
    sha256(territories) !== cldr.sha256 && `${territoriesFile} does not hash to the pinned SHA-256`,
    sha256(license) !== cldr.licenseSha256 && `${licenseFile} does not hash to the pinned SHA-256`,
    pinned['tag'] !== cldr.release && 'manifest.json names another tag',
    pinned['sha256'] !== cldr.sha256 && 'manifest.json pins another file hash',
    pinned['licenseSha256'] !== cldr.licenseSha256 && 'manifest.json pins another license hash',
    pinned['license'] !== 'Unicode-3.0' && 'manifest.json names another license',
  ].filter((problem) => problem !== false);
  if (mismatches.length > 0) throw new Error(mismatches.join('\n'));
  return territories;
}

/** The latest countries file, or undefined before the first one. */
async function latestCountries(countriesDir: string): Promise<CountriesFile | undefined> {
  let names: string[];
  try {
    names = await readdir(countriesDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const numbers = names.flatMap((name) => {
    const match = countriesFilePattern.exec(name);
    return match?.[1] === undefined ? [] : [Number(match[1])];
  });
  if (numbers.length === 0) return undefined;
  const latest = Math.max(...numbers);
  const bytes = await readFile(join(countriesDir, `${String(latest)}.json`));
  return countriesFileSchema.parse(parseJsonSubset(bytes, maxKnowledgeJsonDepth));
}

/**
 * Builds the next countries file from the vendored CLDR release (spec 0002, R7). Fails on a
 * vendored file or license that does not match the pins, on any region code that is neither
 * excluded nor in the previous countries file, and on any code of the previous file the release
 * drops unless it is listed as withdrawn, so a reviewed change classifies each first. Returns
 * undefined when the latest file already holds the same release and codes.
 */
export async function generateCountries(
  packageDir: string,
): Promise<GeneratedCountries | undefined> {
  const territories = await readVendored(join(packageDir, 'vendor', 'cldr', cldr.release));
  const countriesDir = join(packageDir, 'data', 'countries');
  const previous = await latestCountries(countriesDir);
  const { included, unclassified, removed } = classifyRegions(
    regionCodes(parseJsonSubset(territories, maxKnowledgeJsonDepth)),
    previous?.codes,
  );
  const problems = [
    unclassified.length > 0 &&
      `Admit or exclude these new region codes: ${unclassified.join(', ')}`,
    removed.length > 0 && `Withdraw these dropped codes: ${removed.join(', ')}`,
  ].filter((problem) => problem !== false);
  if (problems.length > 0) {
    throw new Error(`In scripts/countries.ts first:\n${problems.join('\n')}`);
  }
  if (
    previous?.cldr.sha256 === cldr.sha256 &&
    previous.codes.length === included.length &&
    previous.codes.every((code, index) => code === included[index])
  ) {
    return undefined;
  }
  const number = (previous?.number ?? 0) + 1;
  const file: CountriesFile = {
    schemaVersion: 1,
    id: 'countries',
    number,
    cldr: {
      release: cldr.release,
      sha256: cldr.sha256,
      license: 'Unicode-3.0',
      licenseSha256: cldr.licenseSha256,
    },
    codes: [...included],
  };
  return {
    file: `data/countries/${String(number)}.json`,
    content: `${JSON.stringify(countriesFileSchema.parse(file), null, 2)}\n`,
  };
}

async function main(): Promise<void> {
  const packageDir = fileURLToPath(new URL('..', import.meta.url));
  const generated = await generateCountries(packageDir);
  if (generated === undefined) {
    process.stdout.write('The latest countries file is up to date\n');
    return;
  }
  await mkdir(dirname(join(packageDir, generated.file)), { recursive: true });
  await writeFile(join(packageDir, generated.file), generated.content, { flag: 'wx' });
  process.stdout.write(`Wrote ${generated.file}\n`);
}

if (import.meta.main) await main();
