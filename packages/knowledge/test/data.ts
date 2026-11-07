import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CatalogEntry, parseCalendarDate } from '@arca/domain';
import { expect } from 'vitest';
import { buildKnowledge, catalogModule, formatIssue } from '../scripts/build.ts';
import { parseEntries } from '../src/entries.ts';
import { rfc8785Vectors } from '../scripts/vectors.ts';
import { contentHash } from '../scripts/content-hash.ts';
import { loadData } from '../scripts/load.ts';
import { validateData } from '../scripts/validate.ts';

/** Synthetic knowledge only: user-assigned country codes, reserved hosts, invented rules. */
export const buildDate = parseCalendarDate('2026-11-03');
/** Synthetic trees use user-assigned codes, which only a fixture build accepts. */
export const fixtures = { fixtures: true } as const;

const source = (id: string, url = 'https://www.gov.example/law'): object => ({
  id,
  url,
  title: 'Residence act',
  kind: 'official',
  verifiedAt: '2026-10-01',
});

const commonPins = {
  countries: { id: 'countries', number: 1 },
  formerCountries: { id: 'former-countries', number: 1 },
  officialDomains: [{ id: 'qm-gov', number: 1 }],
};

export function routeVersion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    routeId: 'qm-work',
    number: 1,
    title: 'Sample work route',
    country: 'QM',
    tags: ['work'],
    effectiveFrom: '2020-01-01',
    status: 'open',
    currency: 'EUR',
    sources: [source('law')],
    ...commonPins,
    countrySets: [{ id: 'treaty', number: 1 }],
    requirements: [
      {
        id: 'treaty-citizen',
        title: 'The principal is a citizen of a treaty country',
        expression: {
          op: 'intersects',
          list: { op: 'fact', key: 'principal.citizenships' },
          set: { op: 'set', id: 'treaty' },
        },
        sources: ['law'],
      },
    ],
    assessments: [],
    dependents: [],
    costs: [],
    durations: [],
    ...overrides,
  };
}

/** A valid data tree, by path under `data`, without `hashes.json`. */
export function baseTree(): Record<string, unknown> {
  return {
    'countries/1.json': {
      schemaVersion: 1,
      id: 'countries',
      number: 1,
      cldr: {
        release: '1.0.0',
        sha256: 'a'.repeat(64),
        license: 'Unicode-3.0',
        licenseSha256: 'b'.repeat(64),
      },
      codes: ['QM', 'QN'],
    },
    'former-countries/1.json': {
      schemaVersion: 1,
      id: 'former-countries',
      number: 1,
      codes: ['QMHH'],
      sources: [source('iso', 'https://www.iso.example/3166-3')],
    },
    'official-domains/qm-gov/1.json': {
      schemaVersion: 1,
      id: 'qm-gov',
      number: 1,
      issuer: 'Government of QM',
      hosts: [{ host: 'gov.example', source: source('registry', 'https://registry.example/gov') }],
    },
    'country-sets/treaty/1.json': {
      schemaVersion: 1,
      id: 'treaty',
      number: 1,
      title: 'Treaty countries',
      members: ['QN', 'QMHH'],
      sources: [source('treaty')],
      ...commonPins,
    },
    'routes/qm-work/1.json': routeVersion(),
  };
}

/**
 * Writes a tree to a new temporary directory. Unless `hashes` is given, `hashes.json` records the
 * vectors and whatever the tree's valid files hash to, as a reviewed pull request would.
 */
export async function writeTree(tree: Record<string, unknown>, hashes?: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'arca-knowledge-'));
  for (const [path, content] of Object.entries(tree)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(
      join(dir, path),
      typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`,
    );
  }
  await writeFile(join(dir, 'hashes.json'), JSON.stringify(hashes ?? (await sealed(dir))));
  return dir;
}

async function sealed(dir: string): Promise<unknown> {
  await writeFile(join(dir, 'hashes.json'), JSON.stringify(emptyHashes()));
  const { hashes } = validateData(await loadData(dir), buildDate, fixtures);
  return {
    ...emptyHashes(),
    files: [...hashes].map(([path, sha256]) => ({ path, sha256 })),
  };
}

export function emptyHashes(): { schemaVersion: 1; vectors: object[]; files: object[] } {
  return {
    schemaVersion: 1,
    vectors: rfc8785Vectors.map((vector) => ({
      name: vector.name,
      sha256: contentHash(vector.value),
    })),
    files: [],
  };
}

/** Entries as the runtime reads them: built, written to the module and parsed back. */
export async function builtEntries(tree = baseTree()): Promise<ReadonlyMap<string, CatalogEntry>> {
  const { entries, issues } = await buildKnowledge(await writeTree(tree), buildDate, fixtures);
  expect(issues).toEqual([]);
  const literal = /JSON\.parse\((.*)\);$/m.exec(catalogModule(entries))?.[1] ?? '';
  return parseEntries(JSON.parse(JSON.parse(literal) as string));
}

/** The committed fixture routes on user-assigned codes (spec 0002, R8). */
export const fixturesDir = fileURLToPath(new URL('fixtures/data', import.meta.url));

/** The fixture routes, built with no issues. */
export async function fixtureEntries(): Promise<ReadonlyMap<string, CatalogEntry>> {
  const { entries, issues } = await buildKnowledge(fixturesDir, buildDate, fixtures);
  expect(issues.map(formatIssue)).toEqual([]);
  return parseEntries(entries);
}

export function indicatorFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'homicides',
    number: 1,
    title: 'Intentional homicides',
    unit: 'per 100,000 people',
    valueType: 'decimal',
    sources: [source('stats', 'https://stats.gov.example/homicides')],
    values: [
      { country: 'QM', value: '1.5', year: 2024, source: 'stats' },
      { country: 'QN', value: '12', year: 2023, source: 'stats' },
    ],
    countries: { id: 'countries', number: 1 },
    officialDomains: [{ id: 'qm-gov', number: 1 }],
    ...overrides,
  };
}

export function comparisonFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'destinations',
    number: 1,
    title: 'Destination comparison',
    indicators: [{ id: 'homicides', number: 1 }],
    criteria: [
      {
        id: 'safety',
        title: 'Safety',
        kind: 'indicator',
        indicator: 'homicides',
        zeroAt: '20',
        tenAt: '0.5',
        defaultWeight: 4,
      },
      { id: 'climate', title: 'Climate', kind: 'personal', defaultWeight: 3 },
    ],
    ...overrides,
  };
}

/** The base tree with one indicator and one comparison version that reads it. */
export function comparisonTree(): Record<string, unknown> {
  return {
    ...baseTree(),
    'indicators/homicides/1.json': indicatorFile(),
    'comparisons/destinations/1.json': comparisonFile(),
  };
}
