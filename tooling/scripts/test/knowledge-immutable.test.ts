import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkKnowledgeChange, type Side } from '../src/knowledge-immutable.ts';

/** Synthetic knowledge only: user-assigned country codes, reserved hosts, invented rules. */
const data = 'packages/knowledge/data/';
const vendor = 'packages/knowledge/vendor/';
const vendored = '.github/policy/vendored.json';
const family = 'eval/families/single/1.json';
const sources = '.github/policy/vendored-sources.json';

/** File content with a git mode and object type other than a regular file's. */
class Special {
  readonly content: string;
  readonly mode: string;
  readonly type: string;

  constructor(content: string, mode = '100644', type = 'blob') {
    this.content = content;
    this.mode = mode;
    this.type = type;
  }
}

type Tree = Record<string, unknown>;

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const territories = '{"territories":{"QM":"Sample"}}';
const licenseText = 'SAMPLE LICENSE';
const entry = {
  repository: 'example-org/sample-data',
  tag: '1.0.0',
  commit: 'a'.repeat(40),
  path: 'main/en/territories.json',
  sha256: sha256(territories),
  licensePath: 'LICENSE',
  licenseSha256: sha256(licenseText),
  license: 'Sample-1.0',
};
const sourcesFile = {
  schemaVersion: 1,
  sources: [
    {
      repository: entry.repository,
      licenses: [{ license: entry.license, sha256: entry.licenseSha256 }],
    },
  ],
};

const officialList = (hosts: [string, string][]): object => ({
  schemaVersion: 1,
  hosts: hosts.map(([host, url]) => ({ host, source: { url } })),
});

const caseEntry = (id: string, overrides: object = {}): Record<string, unknown> => ({
  id,
  principal: 'p1',
  snapshot: { people: [{ id: 'p1' }] },
  expected: { status: 'eligible' },
  ...overrides,
});

function baseTree(): Tree {
  return {
    [`${data}countries/1.json`]: { codes: ['QM'] },
    [family]: { recordedOn: '2026-10-01', members: ['p1'] },
    [`${data}routes/qm-work/1.json`]: { number: 1 },
    [`${data}routes/qm-work/1.cases.json`]: { schemaVersion: 1, cases: [caseEntry('c1')] },
    [`${data}hashes.json`]: {
      schemaVersion: 1,
      vectors: [{ name: 'v', sha256: '1' }],
      files: [{ path: 'routes/qm-work/1.json', sha256: '2' }],
    },
    [`${data}official-domains/qm-gov/1.json`]: officialList([
      ['gov.example', 'https://registry.example/gov'],
    ]),
    [sources]: sourcesFile,
    [vendored]: { schemaVersion: 1, entries: [entry] },
    'packages/domain/src/index.ts': 'export {};',
  };
}

function side(tree: Tree): Side {
  const contents = new Map(
    Object.entries(tree).map(([path, value]) => [
      path,
      value instanceof Special
        ? value
        : new Special(typeof value === 'string' ? value : JSON.stringify(value)),
    ]),
  );
  return {
    files: new Map(
      [...contents].map(([path, { content, mode, type }]) => [
        path,
        { mode, type, object: createHash('sha1').update(content).digest('hex') },
      ]),
    ),
    read: (path) => Promise.resolve(Buffer.from(contents.get(path)?.content ?? '')),
  };
}

async function problems(
  change: (tree: Tree) => void,
  { domainChanged = false, base = baseTree() } = {},
): Promise<string[]> {
  const head = structuredClone(base);
  for (const [path, value] of Object.entries(base)) {
    if (value instanceof Special) head[path] = value;
  }
  change(head);
  const { violations } = await checkKnowledgeChange({
    base: side(base),
    head: side(head),
    domainChanged,
  });
  return violations.map(({ where, problem }) => `${where}: ${problem}`);
}

const casesPath = `${data}routes/qm-work/1.cases.json`;
const casesOf = (tree: Tree): Record<string, unknown>[] =>
  (tree[casesPath] as { cases: Record<string, unknown>[] }).cases;
const hashesOf = (tree: Tree) =>
  tree[`${data}hashes.json`] as {
    schemaVersion: number;
    vectors: { name: string; sha256: string }[];
    files: { path: string; sha256: string }[];
  };

describe('knowledge-immutable', () => {
  it('accepts a change that leaves knowledge alone', async () => {
    expect(await problems(() => undefined)).toEqual([]);
  });

  it('accepts a new numbered file with its hash appended', async () => {
    expect(
      await problems((tree) => {
        tree[`${data}routes/qm-work/2.json`] = { number: 2 };
        hashesOf(tree).files.push({ path: 'routes/qm-work/2.json', sha256: '3' });
      }),
    ).toEqual([]);
  });

  describe('files', () => {
    it.each<[string, (tree: Tree) => void, string]>([
      [
        'a modified file',
        (tree) => {
          tree[`${data}routes/qm-work/1.json`] = { number: 1, changed: true };
        },
        `${data}routes/qm-work/1.json: was modified; it is immutable, so add a new numbered file instead`,
      ],
      [
        'a deleted file',
        (tree) => {
          Reflect.deleteProperty(tree, `${data}countries/1.json`);
        },
        `${data}countries/1.json: exists on the base branch and was deleted or renamed; it is immutable`,
      ],
      [
        'a renamed file',
        (tree) => {
          tree[`${data}countries/2.json`] = tree[`${data}countries/1.json`];
          Reflect.deleteProperty(tree, `${data}countries/1.json`);
        },
        `${data}countries/1.json: exists on the base branch and was deleted or renamed; it is immutable`,
      ],
      [
        'a file turned into a symbolic link',
        (tree) => {
          tree[`${data}countries/1.json`] = new Special(
            JSON.stringify({ codes: ['QM'] }),
            '120000',
          );
        },
        `${data}countries/1.json: changed its file mode or type; it is immutable`,
      ],
      [
        'a new symbolic link',
        (tree) => {
          tree[`${data}countries/2.json`] = new Special('1.json', '120000');
        },
        `${data}countries/2.json: must be a regular file`,
      ],
      [
        'a new executable file',
        (tree) => {
          tree[`${data}countries/2.json`] = new Special('{}', '100755');
        },
        `${data}countries/2.json: must be a regular file`,
      ],
      [
        'a modified vendored file',
        (tree) => {
          tree[`${vendor}x/1/a.json`] = '{"b":1}';
        },
        `${vendor}x/1/a.json: was modified; it is immutable, so add a new numbered file instead`,
      ],
    ])('refuses %s', async (_, change, message) => {
      const base = { ...baseTree(), [`${vendor}x/1/a.json`]: '{"a":1}' };
      expect(await problems(change, { base })).toContain(message);
    });
  });

  it.each<[string, string, Special]>([
    ['the data root', 'packages/knowledge/data', new Special('../../elsewhere', '120000')],
    ['the vendor root', 'packages/knowledge/vendor', new Special('../../elsewhere', '120000')],
    ['the vendor root', 'packages/knowledge/vendor', new Special('', '160000', 'commit')],
  ])('refuses %s as a link or a submodule', async (_, root, entry) => {
    expect(
      await problems((tree) => {
        tree[root] = entry;
      }),
    ).toContain(`${root}: must be a directory, not a link or a submodule`);
  });

  it('keeps synthetic families immutable, and accepts a new number', async () => {
    expect(
      await problems((tree) => {
        tree[family] = { recordedOn: '2026-10-02', members: ['p1'] };
        tree['eval/families/single/2.json'] = { recordedOn: '2026-10-02', members: ['p1'] };
      }),
    ).toEqual([`${family}: was modified; it is immutable, so add a new numbered file instead`]);
    expect(
      await problems((tree) => {
        Reflect.deleteProperty(tree, family);
      }),
    ).toEqual([`${family}: exists on the base branch and was deleted or renamed; it is immutable`]);
  });

  it.each(['packages', 'packages/knowledge', 'eval', 'eval/families', '.github', '.github/policy'])(
    'refuses %s as a link',
    async (directory) => {
      expect(
        await problems((tree) => {
          tree[directory] = new Special('../elsewhere', '120000');
        }),
      ).toContain(`${directory}: must be a directory, not a link or a submodule`);
    },
  );

  it.each([vendored, sources])('refuses %s as a link', async (policy) => {
    expect(
      await problems((tree) => {
        tree[policy] = new Special('{"schemaVersion":1,"entries":[]}', '120000');
      }),
    ).toContain(`${policy}: must be a regular file`);
  });

  it('accepts adding an empty vendored.json with vendored-sources.json', async () => {
    const base = baseTree();
    Reflect.deleteProperty(base, vendored);
    Reflect.deleteProperty(base, sources);
    expect(
      await problems(
        (tree) => {
          tree[vendored] = { schemaVersion: 1, entries: [] };
          tree[sources] = sourcesFile;
        },
        { base },
      ),
    ).toEqual([]);
  });

  describe('hashes.json', () => {
    it.each<[string, (tree: Tree) => void, string]>([
      [
        'a changed hash',
        (tree) => {
          hashesOf(tree).files[0] = { path: 'routes/qm-work/1.json', sha256: '9' };
        },
        'changed the entry with path routes/qm-work/1.json; entries are append-only',
      ],
      [
        'a removed vector',
        (tree) => {
          hashesOf(tree).vectors = [];
        },
        'lost the entry with name v',
      ],
      [
        'a second entry for a path',
        (tree) => {
          hashesOf(tree).files.push({ path: 'routes/qm-work/1.json', sha256: '9' });
        },
        'has 2 entries with path routes/qm-work/1.json',
      ],
      [
        'a changed schema version',
        (tree) => {
          hashesOf(tree).schemaVersion = 2;
        },
        'changed a field other than vectors and files',
      ],
    ])('refuses %s', async (_, change, message) => {
      expect(await problems(change)).toContain(`${data}hashes.json: ${message}`);
    });
  });

  describe('cases files', () => {
    const superseding = (overrides: object = {}): Record<string, unknown> =>
      caseEntry('c2', {
        supersedes: 'c1',
        reason: 'The engine now counts the spouse',
        expected: { status: 'not_eligible' },
        ...overrides,
      });

    it('accepts an appended case', async () => {
      expect(await problems((tree) => casesOf(tree).push(caseEntry('c2')))).toEqual([]);
    });

    it('accepts a superseding case that differs only in its expected results', async () => {
      expect(
        await problems((tree) => casesOf(tree).push(superseding()), { domainChanged: true }),
      ).toEqual([]);
    });

    it.each<[string, (tree: Tree) => void, string, boolean]>([
      [
        'a removed case',
        (tree) => casesOf(tree).splice(0, 1),
        `${casesPath}: lost the entry with id c1`,
        true,
      ],
      [
        'a changed case',
        (tree) => {
          casesOf(tree)[0] = caseEntry('c1', { expected: { status: 'not_eligible' } });
        },
        `${casesPath}: changed the entry with id c1; entries are append-only`,
        true,
      ],
      [
        'a superseding case without a change to the domain code',
        (tree) => casesOf(tree).push(superseding()),
        `${casesPath} case c2: supersedes a case, but the change does not touch packages/domain/src`,
        false,
      ],
      [
        'a superseding case with another snapshot',
        (tree) => casesOf(tree).push(superseding({ snapshot: { people: [] } })),
        `${casesPath} case c2: differs from case c1 in more than its expected results`,
        true,
      ],
      [
        'a superseding case with the same expected results',
        (tree) => casesOf(tree).push(superseding({ expected: { status: 'eligible' } })),
        `${casesPath} case c2: expects the same results as case c1`,
        true,
      ],
      [
        'a superseding case without a reason',
        (tree) => casesOf(tree).push(superseding({ reason: ' ' })),
        `${casesPath} case c2: supersedes a case without a reason`,
        true,
      ],
      [
        'a superseding case for a case not on the base branch',
        (tree) => casesOf(tree).push(superseding({ supersedes: 'c9' })),
        `${casesPath} case c2: supersedes a case that is not on the base branch`,
        true,
      ],
      [
        'two cases superseding the same case',
        (tree) => casesOf(tree).push(superseding(), superseding({ id: 'c3' })),
        `${casesPath} case c3: supersedes case c1, which another new case supersedes too`,
        true,
      ],
      [
        'a superseding case in a new cases file',
        (tree) => {
          tree[`${data}routes/qm-work/2.cases.json`] = {
            schemaVersion: 1,
            cases: [superseding()],
          };
        },
        `${data}routes/qm-work/2.cases.json case c2: supersedes a case that is not on the base branch`,
        true,
      ],
      [
        'two cases with the same id',
        (tree) => casesOf(tree).push(caseEntry('c1')),
        `${casesPath}: has 2 entries with id c1`,
        true,
      ],
    ])('refuses %s', async (_, change, message, domainChanged) => {
      expect(await problems(change, { domainChanged })).toContain(message);
    });

    it('refuses a case whose 0 became -0, which hashes the same', async () => {
      const base = baseTree();
      casesOf(base)[0] = caseEntry('c1', { expected: { status: 'eligible', amount: 0 } });
      const found = await problems(
        (tree) => {
          tree[casesPath] = JSON.stringify({ schemaVersion: 1, cases: casesOf(base) }).replace(
            '"amount":0',
            '"amount":-0',
          );
        },
        { base },
      );
      expect(
        found.some((problem) =>
          problem.startsWith(`${casesPath}: is not in the accepted JSON subset`),
        ),
      ).toBe(true);
    });

    it('refuses superseding a case that is already superseded', async () => {
      const base = baseTree();
      casesOf(base).push(superseding());
      expect(
        await problems((tree) => casesOf(tree).push(superseding({ id: 'c3' })), {
          base,
          domainChanged: true,
        }),
      ).toContain(`${casesPath} case c3: supersedes case c1, which is already superseded`);
    });
  });

  describe('country guides', () => {
    const guide = `${data}guides/qm/1.json`;
    const withHash = (tree: Tree, path: string): void => {
      hashesOf(tree).files.push({ path, sha256: '5' });
    };

    it('accepts new guides alone, with their hashes', async () => {
      expect(
        await problems((tree) => {
          tree[guide] = { number: 1 };
          tree[`${data}guides/qn/1.json`] = { number: 1 };
          withHash(tree, 'guides/qm/1');
          withHash(tree, 'guides/qn/1');
        }),
      ).toEqual([]);
    });

    it.each<[string, (tree: Tree) => void, string[]]>([
      [
        'a guide added with a route version',
        (tree) => {
          tree[guide] = { number: 1 };
          tree[`${data}routes/qm-work/2.json`] = { number: 2 };
        },
        [`${guide}: changes a country guide together with other knowledge data`],
      ],
      [
        'a guide added with a cases entry',
        (tree) => {
          tree[guide] = { number: 1 };
          casesOf(tree).push(caseEntry('c2'));
        },
        [`${guide}: changes a country guide together with other knowledge data`],
      ],
      [
        'a guide added with an official-domain list',
        (tree) => {
          tree[guide] = { number: 1 };
          tree[`${data}official-domains/qm-gov/2.json`] = officialList([
            ['gov.example', 'https://registry.example/gov'],
          ]);
        },
        [
          `${data}official-domains/qm-gov/2.json: changes an official-domain list together with other knowledge data`,
          `${guide}: changes a country guide together with other knowledge data`,
        ],
      ],
    ])('refuses %s', async (_, change, messages) => {
      const found = await problems(change);
      for (const message of messages) expect(found).toContain(message);
    });

    it('keeps a merged guide immutable', async () => {
      const base = baseTree();
      base[guide] = { number: 1 };
      expect(
        await problems(
          (tree) => {
            tree[guide] = { number: 1, title: 'changed' };
          },
          { base },
        ),
      ).toContain(`${guide}: was modified; it is immutable, so add a new numbered file instead`);
    });
  });

  describe('official-domain lists', () => {
    const list2 = `${data}official-domains/qm-gov/2.json`;

    it('accepts a new version alone, with its hash, whose added host cites a merged host', async () => {
      expect(
        await problems((tree) => {
          tree[list2] = officialList([
            ['gov.example', 'https://registry.example/gov'],
            ['visa.example', 'https://www.gov.example/agencies'],
          ]);
          hashesOf(tree).files.push({ path: 'official-domains/qm-gov/2.json', sha256: '4' });
        }),
      ).toEqual([]);
    });

    it('accepts the first list for an issuer alone', async () => {
      expect(
        await problems((tree) => {
          tree[`${data}official-domains/qn-gov/1.json`] = officialList([
            ['qn.example', 'https://registry.example/qn'],
          ]);
        }),
      ).toEqual([]);
    });

    it.each<[string, (tree: Tree) => void, string]>([
      [
        'a list changed with other knowledge data',
        (tree) => {
          tree[list2] = officialList([['gov.example', 'https://registry.example/gov']]);
          tree[`${data}routes/qm-work/2.json`] = { number: 2 };
        },
        `${list2}: changes an official-domain list together with other knowledge data`,
      ],
      [
        'an added host whose proof is on a host no list on main has',
        (tree) => {
          tree[list2] = officialList([['visa.example', 'https://visa.example/about']]);
        },
        `${list2}: adds host visa.example with proof on visa.example, which is not a host of an official-domain list on main`,
      ],
      [
        'an added host whose proof URL hides its host',
        (tree) => {
          tree[list2] = officialList([['visa.example', 'https://gov.example@visa.example/']]);
        },
        `${list2}: adds host visa.example with proof on an unreadable URL, which is not a host of an official-domain list on main`,
      ],
      [
        'a first list for an issuer with another list change',
        (tree) => {
          tree[`${data}official-domains/qn-gov/1.json`] = officialList([
            ['qn.example', 'https://registry.example/qn'],
          ]);
          tree[list2] = officialList([['gov.example', 'https://registry.example/gov']]);
        },
        `${data}official-domains/qn-gov/1.json: is the first list for its issuer, so it goes in a pull request alone`,
      ],
      [
        'a first list whose host vouches for itself',
        (tree) => {
          tree[`${data}official-domains/qn-gov/1.json`] = officialList([
            ['migration.qn.example', 'https://migration.qn.example/about'],
          ]);
        },
        `${data}official-domains/qn-gov/1.json: is a first list whose host migration.qn.example cites proof on migration.qn.example, a host of the same list or its parent, not a registry`,
      ],
      [
        'a first list whose host vouches for another of the same list',
        (tree) => {
          tree[`${data}official-domains/qn-gov/1.json`] = officialList([
            ['qn.example', 'https://registry.example/qn'],
            ['visa.example', 'https://www.qn.example/agencies'],
          ]);
        },
        `${data}official-domains/qn-gov/1.json: is a first list whose host visa.example cites proof on www.qn.example, a host of the same list or its parent, not a registry`,
      ],
      [
        'a first list whose host vouches for itself from its parent domain',
        (tree) => {
          tree[`${data}official-domains/qn-gov/1.json`] = officialList([
            ['www.qn.example', 'https://qn.example/about'],
          ]);
        },
        `${data}official-domains/qn-gov/1.json: is a first list whose host www.qn.example cites proof on qn.example, a host of the same list or its parent, not a registry`,
      ],
      [
        'a first list with a bare top-level domain',
        (tree) => {
          tree[`${data}official-domains/qn-gov/1.json`] = officialList([
            ['qn', 'https://registry.example/qn'],
          ]);
        },
        `${data}official-domains/qn-gov/1.json: lists qn, a top-level domain, not a host`,
      ],
    ])('refuses %s', async (_, change, message) => {
      expect(await problems(change)).toContain(message);
    });
  });

  describe('vendored files', () => {
    const directory = `${vendor}sample/1.0.0/`;
    const vendorFiles = (tree: Tree, manifest: object = entry): void => {
      tree[`${directory}manifest.json`] = manifest;
      tree[`${directory}territories.json`] = territories;
      tree[`${directory}LICENSE`] = licenseText;
    };

    it('accepts files that match an entry approved on main', async () => {
      expect(
        await problems((tree) => {
          vendorFiles(tree);
        }),
      ).toEqual([]);
    });

    it.each<[string, (tree: Tree) => void, string]>([
      [
        'a manifest that differs from the approved entry',
        (tree) => {
          vendorFiles(tree, { ...entry, tag: '1.0.1' });
        },
        `${directory}manifest.json: must exist and equal an entry of vendored.json on main`,
      ],
      [
        'files without a manifest',
        (tree) => {
          tree[`${directory}territories.json`] = territories;
        },
        `${directory}manifest.json: must exist and equal an entry of vendored.json on main`,
      ],
      [
        'a data file with another hash',
        (tree) => {
          vendorFiles(tree);
          tree[`${directory}territories.json`] = '{"territories":{}}';
        },
        `${directory}territories.json: hashes to neither the data file nor the license of its approved entry`,
      ],
      [
        'a missing license file',
        (tree) => {
          vendorFiles(tree);
          Reflect.deleteProperty(tree, `${directory}LICENSE`);
        },
        `${directory}: has no file with the approved licenseSha256`,
      ],
    ])('refuses %s', async (_, change, message) => {
      expect(await problems(change)).toContain(message);
    });
  });

  describe('vendored.json', () => {
    const next = { ...entry, tag: '2.0.0', commit: 'b'.repeat(40) };
    const entriesOf = (tree: Tree): object[] => (tree[vendored] as { entries: object[] }).entries;

    it('refuses an entry with a duplicate key, which a reviewer would misread', async () => {
      const found = await problems((tree) => {
        tree[vendored] = JSON.stringify({ schemaVersion: 1, entries: [entry, next] }).replace(
          '"tag":"2.0.0"',
          '"tag":"9.9.9","tag":"2.0.0"',
        );
      });
      expect(
        found.some((problem) =>
          problem.startsWith(
            `${vendored}: is not in the accepted JSON subset: Duplicate key "tag"`,
          ),
        ),
      ).toBe(true);
    });

    it('passes a new valid entry on for upstream checks', async () => {
      const head = baseTree();
      entriesOf(head).push(next);
      const verdict = await checkKnowledgeChange({
        base: side(baseTree()),
        head: side(head),
        domainChanged: false,
      });
      expect(verdict).toEqual({ violations: [], newEntries: [next] });
    });

    it.each<[string, (tree: Tree) => void, string]>([
      [
        'a changed entry',
        (tree) => {
          entriesOf(tree)[0] = { ...entry, sha256: 'c'.repeat(64) };
        },
        `${vendored}: changed or removed an approved entry; it is append-only`,
      ],
      [
        'a removed entry',
        (tree) => entriesOf(tree).splice(0, 1),
        `${vendored}: changed or removed an approved entry; it is append-only`,
      ],
      [
        'an entry added with vendored files',
        (tree) => {
          entriesOf(tree).push(next);
          tree[`${vendor}sample/2.0.0/manifest.json`] = next;
        },
        `${vendored}: changes in a policy pull request of its own, before any vendored file`,
      ],
      [
        'vendored-sources.json changed with an entry',
        (tree) => {
          entriesOf(tree).push(next);
          (tree[sources] as { sources: object[] }).sources.push({
            repository: 'example-org/more',
            licenses: [],
          });
        },
        `${sources}: changes in a policy pull request of its own`,
      ],
      [
        'an entry from a repository not allow-listed',
        (tree) => entriesOf(tree).push({ ...next, repository: 'someone/fork' }),
        `${vendored} new entry: names a repository not in vendored-sources.json`,
      ],
      [
        'an entry whose license text is not pinned',
        (tree) => entriesOf(tree).push({ ...next, licenseSha256: 'd'.repeat(64) }),
        `${vendored} new entry: has a license and license hash not pinned in vendored-sources.json`,
      ],
    ])('refuses %s', async (_, change, message) => {
      expect(await problems(change)).toContain(message);
    });
  });
});
