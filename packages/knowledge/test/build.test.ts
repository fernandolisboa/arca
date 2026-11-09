import { rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEntries } from '../src/entries.ts';
import { buildKnowledge, catalogModule, formatIssue, todayUtc } from '../scripts/build.ts';
import { contentHash } from '../scripts/content-hash.ts';
import type { Json } from '@arca/scripts/json';
import { baseTree, buildDate, emptyHashes, fixtures, routeVersion, writeTree } from './data.ts';

async function issuesOf(tree: Record<string, unknown>, hashes?: unknown): Promise<string[]> {
  const { issues } = await buildKnowledge(await writeTree(tree, hashes), buildDate, fixtures);
  return issues.map(formatIssue);
}

const tokenRequirement = (expression: object): Record<string, unknown> => ({
  requirements: [
    {
      id: 'listed',
      title: 'The principal fits the listed countries',
      expression,
      sources: ['law'],
    },
  ],
});
const citizenOf = (values: string[]): object => ({
  op: 'intersects',
  list: { op: 'fact', key: 'principal.citizenships' },
  set: { op: 'tokens', values },
});
const residentOf = (values: string[]): object => ({
  op: 'in',
  item: { op: 'fact', key: 'principal.residenceCountry' },
  set: { op: 'tokens', values },
});

describe('buildKnowledge', () => {
  it('refuses user-assigned codes outside a fixture build', async () => {
    const { issues } = await buildKnowledge(await writeTree(baseTree()), buildDate);
    expect(issues.map(formatIssue)).toContain(
      'countries/1.json /codes: User-assigned codes are for fixtures only',
    );
  });

  it('builds the real data directory on the date the real build uses', async () => {
    const dataDir = fileURLToPath(new URL('../data', import.meta.url));
    expect((await buildKnowledge(dataDir, todayUtc())).issues).toEqual([]);
  });

  it('checks country tokens against the pinned countries and former countries', async () => {
    const tree = baseTree();
    tree['routes/qm-work/1.json'] = routeVersion(tokenRequirement(citizenOf(['QN', 'QMHH'])));
    const { issues } = await buildKnowledge(await writeTree(tree), buildDate, fixtures);
    expect(issues.filter((issue) => issue.file !== 'hashes.json')).toEqual([]);
  });

  it('builds a valid tree into one entry per route version', async () => {
    const tree = baseTree();
    const { entries, issues } = await buildKnowledge(await writeTree(tree), buildDate, fixtures);
    expect(issues).toEqual([]);
    expect(entries).toEqual([
      {
        hash: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
        version: tree['routes/qm-work/1.json'],
        countrySets: [tree['country-sets/treaty/1.json']],
      },
    ]);
  });

  it('hashes the version with every file it pins, transitively, in one container', async () => {
    const tree = baseTree();
    const { entries } = await buildKnowledge(await writeTree(tree), buildDate, fixtures);
    const pinned = {
      'countries/countries/1': tree['countries/1.json'],
      'former-countries/former-countries/1': tree['former-countries/1.json'],
      'official-domains/qm-gov/1': tree['official-domains/qm-gov/1.json'],
      'country-sets/treaty/1': tree['country-sets/treaty/1.json'],
    } as Record<string, Json>;
    expect(entries[0]?.hash).toBe(
      contentHash({ version: tree['routes/qm-work/1.json'] as Json, pinned }),
    );
  });

  it('keeps the hash of a fixed tree, so a change to the container shows up in review', async () => {
    const { entries } = await buildKnowledge(await writeTree(baseTree()), buildDate, fixtures);
    expect(entries[0]?.hash).toBe(
      'c756ab8089f87e0a95cc93235e23b394f2c67e8fb09031995ce7652543bbbab5',
    );
  });

  it('changes the hash when a pinned file changes', async () => {
    const first = await buildKnowledge(await writeTree(baseTree()), buildDate, fixtures);
    const tree = baseTree();
    tree['country-sets/treaty/1.json'] = {
      ...(tree['country-sets/treaty/1.json'] as object),
      title: 'Treaty countries, renamed',
    };
    const second = await buildKnowledge(await writeTree(tree), buildDate, fixtures);
    expect(second.entries[0]?.hash).not.toBe(first.entries[0]?.hash);
  });

  describe('hashes.json', () => {
    it('reports a missing entry with the hash to append', async () => {
      const issues = await issuesOf(baseTree(), emptyHashes());
      expect(issues).toEqual([
        expect.stringMatching(
          /^hashes\.json: country-sets\/treaty\/1 has no recorded hash; append [0-9a-f]{64}$/,
        ),
        expect.stringMatching(
          /^hashes\.json: routes\/qm-work\/1 has no recorded hash; append [0-9a-f]{64}$/,
        ),
      ]);
    });

    it('reports a hash that differs from the recorded one', async () => {
      const hashes = emptyHashes();
      const wrong = '0'.repeat(64);
      hashes.files = [
        { path: 'routes/qm-work/1', sha256: wrong },
        { path: 'country-sets/treaty/1', sha256: wrong },
      ];
      const issues = await issuesOf(baseTree(), hashes);
      expect(issues).toHaveLength(2);
      expect(issues.every((issue) => issue.includes(`not the recorded ${wrong}`))).toBe(true);
    });

    it('reports a changed vector hash and an entry with no file', async () => {
      const hashes = emptyHashes();
      hashes.vectors = [
        ...hashes.vectors.map((vector) => ({ ...vector, sha256: 'f'.repeat(64) })),
        { name: 'gone', sha256: 'f'.repeat(64) },
      ];
      hashes.files = [{ path: 'routes/qm-gone/1', sha256: 'a'.repeat(64) }];
      const issues = await issuesOf({}, hashes);
      expect(issues).toEqual([
        expect.stringContaining('vector primitives hashes to'),
        expect.stringContaining('vector sorting hashes to'),
        expect.stringContaining('vector numbers hashes to'),
        'hashes.json: routes/qm-gone/1 has a recorded hash but no file',
        'hashes.json: vector gone has a recorded hash but no vector',
      ]);
    });

    it('refuses duplicate entries', async () => {
      const hashes = emptyHashes();
      hashes.vectors = [...hashes.vectors, ...hashes.vectors.slice(0, 1)];
      expect(await issuesOf({}, hashes)).toEqual([
        'hashes.json: The vector primitives has more than one entry',
      ]);
    });
  });

  describe('files', () => {
    it.each([
      [
        'a file outside the layout',
        'routes/qm-work/notes.txt',
        'is not where the knowledge layout puts any file',
      ],
      [
        'a number with a leading zero',
        'routes/qm-work/01.json',
        'is not where the knowledge layout puts any file',
      ],
      ['a duplicate key', 'routes/qm-work/1.json', 'Duplicate key'],
    ])('refuses %s', async (_, file, message) => {
      const tree = baseTree();
      tree[file] = '{"schemaVersion":1,"schemaVersion":1}';
      expect(
        (await issuesOf(tree)).some((issue) => issue.startsWith(file) && issue.includes(message)),
      ).toBe(true);
    });

    it('refuses a symbolic link', async () => {
      const dir = await writeTree(baseTree());
      await symlink(join(dir, 'countries/1.json'), join(dir, 'countries/2.json'));
      const { issues } = await buildKnowledge(dir, buildDate, fixtures);
      expect(issues.map(formatIssue)).toContain(
        'countries/2.json: Only regular files belong in data',
      );
    });

    it.each([
      [1024 * 1024, false],
      [1024 * 1024 + 1, true],
    ])('limits a file of %i bytes (refused: %s)', async (size, refused) => {
      const tree = { ...baseTree(), 'countries/2.json': ' '.repeat(size) };
      const sizeIssue = 'countries/2.json: A knowledge file is at most 1048576 bytes';
      expect((await issuesOf(tree)).includes(sizeIssue)).toBe(refused);
    });

    it('requires hashes.json', async () => {
      const dir = await writeTree({});
      await rm(join(dir, 'hashes.json'));
      const { issues } = await buildKnowledge(dir, buildDate, fixtures);
      expect(issues.map(formatIssue)).toEqual([
        'hashes.json: The hashes file is missing or unreadable',
      ]);
    });

    it('leaves checking cases files to the cases runner', async () => {
      const tree = { ...baseTree(), 'routes/qm-work/1.cases.json': 'not checked by the build' };
      expect(await issuesOf(tree)).toEqual([]);
    });
  });

  describe('validation', () => {
    const variants: [string, (tree: Record<string, unknown>) => void, string][] = [
      [
        'an ID that disagrees with the path',
        (tree) => {
          tree['routes/qm-work/1.json'] = routeVersion({ routeId: 'qm-other' });
        },
        'routes/qm-work/1.json: The ID and number match the file path',
      ],
      [
        'a gap in version numbers',
        (tree) => {
          tree['routes/qm-work/3.json'] = routeVersion({ number: 3, effectiveFrom: '2022-01-01' });
        },
        'routes/qm-work/3.json: Version numbers are contiguous from 1',
      ],
      [
        'a pin to a file that does not exist',
        (tree) => {
          tree['routes/qm-work/1.json'] = routeVersion({
            countrySets: [{ id: 'treaty', number: 2 }],
          });
        },
        'routes/qm-work/1.json /countrySets/0: The pinned country-sets file treaty 2 exists and is valid',
      ],
      [
        'a pin to a file with issues',
        (tree) => {
          tree['country-sets/treaty/1.json'] = {
            ...(tree['country-sets/treaty/1.json'] as object),
            members: ['QZ'],
          };
        },
        'routes/qm-work/1.json /countrySets/0: The pinned country-sets file treaty 1 exists and is valid',
      ],
      [
        'a set member outside the pinned countries',
        (tree) => {
          tree['country-sets/treaty/1.json'] = {
            ...(tree['country-sets/treaty/1.json'] as object),
            members: ['QZ'],
          };
        },
        'country-sets/treaty/1.json /members/0: A member is in the pinned countries or former countries',
      ],
      [
        'a country token outside the pinned files',
        (tree) => {
          tree['routes/qm-work/1.json'] = routeVersion(tokenRequirement(citizenOf(['QZ'])));
        },
        'routes/qm-work/1.json /requirements/0/expression: The values are outside the domain of the fact',
      ],
      [
        'a former state in a fact about current countries',
        (tree) => {
          tree['routes/qm-work/1.json'] = routeVersion(tokenRequirement(residentOf(['QMHH'])));
        },
        'routes/qm-work/1.json /requirements/0/expression: The values are outside the domain of the fact',
      ],
      [
        'a set with a former state in a fact about current countries',
        (tree) => {
          tree['routes/qm-work/1.json'] = routeVersion(
            tokenRequirement({
              op: 'in',
              item: { op: 'fact', key: 'principal.residenceCountry' },
              set: { op: 'set', id: 'treaty' },
            }),
          );
        },
        'routes/qm-work/1.json /requirements/0/expression: The values are outside the domain of the fact',
      ],
      [
        "a set member outside the route's countries and former countries",
        (tree) => {
          tree['countries/2.json'] = {
            ...(tree['countries/1.json'] as object),
            number: 2,
            codes: ['QM'],
          };
          tree['routes/qm-work/1.json'] = routeVersion({
            countries: { id: 'countries', number: 2 },
          });
        },
        "routes/qm-work/1.json /countrySets/0: A set's members are in the route's countries or former countries",
      ],
      [
        'a route country outside the pinned countries',
        (tree) => {
          tree['routes/qz-work/1.json'] = routeVersion({ routeId: 'qz-work', country: 'QZ' });
        },
        'routes/qz-work/1.json /country: The country is in the pinned countries file',
      ],
      [
        'an official source on a host no pinned list holds',
        (tree) => {
          tree['routes/qm-work/1.json'] = routeVersion({
            sources: [
              {
                id: 'law',
                url: 'https://evil-gov.example/law',
                title: 'Residence act',
                kind: 'official',
                verifiedAt: '2026-10-01',
              },
            ],
          });
        },
        'routes/qm-work/1.json /sources/0: An official source is on a pinned official host',
      ],
      [
        'a source verified after the build date',
        (tree) => {
          tree['official-domains/qm-gov/1.json'] = {
            schemaVersion: 1,
            id: 'qm-gov',
            number: 1,
            issuer: 'Government of QM',
            hosts: [
              {
                host: 'gov.example',
                source: {
                  id: 'registry',
                  url: 'https://registry.example/gov',
                  title: 'Registry',
                  kind: 'secondary',
                  verifiedAt: '2026-11-04',
                },
              },
            ],
          };
        },
        'official-domains/qm-gov/1.json /hosts/0/source/0/verifiedAt: A source is not verified after the build date',
      ],
      [
        'a duplicate country code',
        (tree) => {
          tree['countries/1.json'] = {
            ...(tree['countries/1.json'] as object),
            codes: ['QM', 'QM'],
          };
        },
        'countries/1.json /codes: Entries are unique',
      ],
      [
        'a correction outside its bounds',
        (tree) => {
          tree['routes/qm-work/2.json'] = routeVersion({ number: 2, effectiveFrom: '2022-01-01' });
          tree['routes/qm-work/3.json'] = routeVersion({
            number: 3,
            effectiveFrom: '2022-01-01',
            corrects: 1,
          });
        },
        'routes/qm-work/3.json: From 2022-01-01, selection would pick version 3 instead of version 2',
      ],
      [
        'a schema violation',
        (tree) => {
          tree['routes/qm-work/1.json'] = routeVersion({ status: 'paused' });
        },
        'routes/qm-work/1.json /status:',
      ],
    ];

    it.each(variants)('reports %s', async (_, change, expected) => {
      const tree = baseTree();
      change(tree);
      const issues = await issuesOf(tree, emptyHashes());
      expect(issues.some((issue) => issue.startsWith(expected))).toBe(true);
    });

    it('gives a file with issues no hash and no entry', async () => {
      const tree = baseTree();
      tree['routes/qm-work/1.json'] = routeVersion({ country: 'QZ', routeId: 'qm-work' });
      const { entries, issues } = await buildKnowledge(
        await writeTree(tree, emptyHashes()),
        buildDate,
        fixtures,
      );
      expect(entries).toEqual([]);
      expect(issues.map(formatIssue)).not.toContainEqual(
        expect.stringContaining('routes/qm-work/1 has no recorded hash'),
      );
    });
  });
});

describe("a source's machine-readable address (spec 0002, R4)", () => {
  const lawSource = (overrides: Record<string, unknown>): Record<string, unknown> => ({
    id: 'law',
    url: 'https://www.gov.example/law',
    title: 'Residence act',
    kind: 'official',
    verifiedAt: '2026-10-01',
    ...overrides,
  });
  const withRouteSource = (overrides: Record<string, unknown>): Record<string, unknown> => ({
    ...baseTree(),
    'routes/qm-work/1.json': routeVersion({ sources: [lawSource(overrides)] }),
  });
  const withSetSource = (overrides: Record<string, unknown>): Record<string, unknown> => {
    const tree = baseTree();
    tree['country-sets/treaty/1.json'] = {
      ...(tree['country-sets/treaty/1.json'] as object),
      sources: [lawSource({ id: 'treaty', ...overrides })],
    };
    return tree;
  };

  it.each([
    ['a route version', withRouteSource],
    ['a country set', withSetSource],
  ])('accepts one on a pinned official host in %s', async (_, treeWith) => {
    const issues = await issuesOf(
      treeWith({ machineReadableUrl: 'https://api.gov.example/law?format=json' }),
    );
    expect(issues).toEqual([]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    [
      'on a host no pinned list holds',
      { machineReadableUrl: 'https://api.other.example/law' },
      '/sources/0/machineReadableUrl: A machine-readable address is on a pinned official host',
    ],
    [
      'on a lookalike host',
      { machineReadableUrl: 'https://evil-gov.example/law' },
      '/sources/0/machineReadableUrl: A machine-readable address is on a pinned official host',
    ],
    [
      'on a host that only starts with a pinned one',
      { machineReadableUrl: 'https://gov.example.evil.example/law' },
      '/sources/0/machineReadableUrl: A machine-readable address is on a pinned official host',
    ],
    [
      'over http',
      { machineReadableUrl: 'http://api.gov.example/law' },
      '/sources/0/machineReadableUrl:',
    ],
    [
      'with user information',
      { machineReadableUrl: 'https://user@api.gov.example/law' },
      '/sources/0/machineReadableUrl:',
    ],
    [
      'with a port',
      { machineReadableUrl: 'https://api.gov.example:8443/law' },
      '/sources/0/machineReadableUrl:',
    ],
    [
      'longer than a source URL',
      { machineReadableUrl: `https://api.gov.example/${'a'.repeat(2000)}` },
      '/sources/0/machineReadableUrl:',
    ],
    [
      'on a secondary source',
      {
        url: 'https://blog.example/law',
        kind: 'secondary',
        machineReadableUrl: 'https://api.gov.example/law',
      },
      '/sources/0/machineReadableUrl: Only an official source has a machine-readable address',
    ],
  ])('refuses one %s', async (_, overrides, expected) => {
    const tree = withRouteSource(overrides);
    if (overrides['kind'] === 'secondary') {
      tree['routes/qm-work/1.json'] = routeVersion({
        sources: [lawSource({ id: 'act' }), lawSource(overrides)],
        requirements: [
          {
            id: 'treaty-citizen',
            title: 'The principal is a citizen of a treaty country',
            expression: citizenOf(['QN']),
            sources: ['act', 'law'],
          },
        ],
      });
    }
    const issues = await issuesOf(tree);
    const index = overrides['kind'] === 'secondary' ? '1' : '0';
    expect(issues).toContainEqual(
      expect.stringContaining(
        `routes/qm-work/1.json ${expected.replace('/sources/0/', `/sources/${index}/`)}`,
      ),
    );
  });

  it('refuses one in a country set on a host no pinned list holds', async () => {
    const issues = await issuesOf(withSetSource({ machineReadableUrl: 'https://other.example/x' }));
    expect(issues).toContain(
      'country-sets/treaty/1.json /sources/0/machineReadableUrl: A machine-readable address is on a pinned official host',
    );
  });

  it('refuses one on the proof of an official host, which pins no list to check it against', async () => {
    const tree = baseTree();
    tree['official-domains/qm-gov/1.json'] = {
      schemaVersion: 1,
      id: 'qm-gov',
      number: 1,
      issuer: 'Government of QM',
      hosts: [
        {
          host: 'gov.example',
          source: lawSource({
            id: 'registry',
            url: 'https://registry.example/gov',
            machineReadableUrl: 'https://registry.example/gov.json',
          }),
        },
      ],
    };
    const issues = await issuesOf(tree);
    expect(issues).toContainEqual(
      expect.stringMatching(/^official-domains\/qm-gov\/1\.json \/hosts\/0\/source:/),
    );
  });

  it('hashes the address with the version, so adding one makes a new version', async () => {
    const without = await buildKnowledge(await writeTree(baseTree()), buildDate, fixtures);
    const tree = withRouteSource({ machineReadableUrl: 'https://api.gov.example/law' });
    const withAddress = await buildKnowledge(await writeTree(tree), buildDate, fixtures);
    expect(withAddress.issues).toEqual([]);
    expect(withAddress.entries[0]?.hash).not.toBe(without.entries[0]?.hash);
  });
});

describe('catalogModule', () => {
  it('keeps the data as data, through JSON.parse', async () => {
    const { entries, countries } = await buildKnowledge(
      await writeTree(baseTree()),
      buildDate,
      fixtures,
    );
    const cases = [{ hash: 'a'.repeat(64), cases: [] }];
    const module = catalogModule({ entries, countries, cases });
    expect(module).toMatch(/^\/\/ Generated by scripts\/build\.ts/);
    const [catalog, pinned, summaries, hosts] = [...module.matchAll(/JSON\.parse\((.*)\);$/gm)].map(
      ([, literal]) => JSON.parse(JSON.parse(literal ?? '') as string) as unknown,
    );
    expect(catalog).toEqual(entries);
    expect(pinned).toEqual(countries);
    expect(summaries).toEqual(cases);
    const urls = [...parseEntries(entries).values()].flatMap(({ version }) =>
      version.sources.map(({ url }) => url),
    );
    expect(Object.keys(hosts as object).sort()).toEqual([...new Set(urls)].sort());
  });

  it('pins the latest countries and former countries', async () => {
    const tree = baseTree();
    const { countries } = await buildKnowledge(await writeTree(tree), buildDate, fixtures);
    expect(countries.countries).toEqual((tree['countries/1.json'] as { codes: string[] }).codes);
    expect(countries.formerCountries).toEqual(
      (tree['former-countries/1.json'] as { codes: string[] }).codes,
    );
  });
});
