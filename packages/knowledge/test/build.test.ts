import { rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildKnowledge, catalogModule, formatIssue } from '../scripts/build.ts';
import { contentHash } from '../scripts/content-hash.ts';
import type { Json } from '../scripts/json.ts';
import { baseTree, buildDate, emptyHashes, routeVersion, writeTree } from './data.ts';

async function issuesOf(tree: Record<string, unknown>, hashes?: unknown): Promise<string[]> {
  const { issues } = await buildKnowledge(await writeTree(tree, hashes), buildDate);
  return issues.map(formatIssue);
}

describe('buildKnowledge', () => {
  it('builds the real data directory', async () => {
    const dataDir = fileURLToPath(new URL('../data', import.meta.url));
    expect((await buildKnowledge(dataDir, buildDate)).issues).toEqual([]);
  });

  it('builds a valid tree into one entry per route version', async () => {
    const tree = baseTree();
    const { entries, issues } = await buildKnowledge(await writeTree(tree), buildDate);
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
    const { entries } = await buildKnowledge(await writeTree(tree), buildDate);
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
    const { entries } = await buildKnowledge(await writeTree(baseTree()), buildDate);
    expect(entries[0]?.hash).toBe(
      '6a10f911228fe06df327ffe50277bc3b3f3aa36a28aded5f3baedd10f48e5cbd',
    );
  });

  it('changes the hash when a pinned file changes', async () => {
    const first = await buildKnowledge(await writeTree(baseTree()), buildDate);
    const tree = baseTree();
    tree['country-sets/treaty/1.json'] = {
      ...(tree['country-sets/treaty/1.json'] as object),
      title: 'Treaty countries, renamed',
    };
    const second = await buildKnowledge(await writeTree(tree), buildDate);
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
      const { issues } = await buildKnowledge(dir, buildDate);
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
      const { issues } = await buildKnowledge(dir, buildDate);
      expect(issues.map(formatIssue)).toEqual([
        'hashes.json: The hashes file is missing or unreadable',
      ]);
    });

    it('collects cases files for the cases runner without parsing them here', async () => {
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
            schemaVersion: 1,
            id: 'countries',
            number: 1,
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
      );
      expect(entries).toEqual([]);
      expect(issues.map(formatIssue)).not.toContainEqual(
        expect.stringContaining('routes/qm-work/1 has no recorded hash'),
      );
    });
  });
});

describe('catalogModule', () => {
  it('keeps the data as data, through JSON.parse', async () => {
    const { entries } = await buildKnowledge(await writeTree(baseTree()), buildDate);
    const module = catalogModule(entries);
    expect(module).toMatch(/^\/\/ Generated by scripts\/build\.ts/);
    const literal = /JSON\.parse\((.*)\);$/m.exec(module)?.[1] ?? '';
    expect(JSON.parse(JSON.parse(literal) as string)).toEqual(entries);
  });
});
