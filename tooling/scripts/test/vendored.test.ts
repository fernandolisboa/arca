import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  entryProblems,
  rawUrl,
  tagCommit,
  verifyEntry,
  type Upstream,
  type VendoredEntry,
} from '../src/vendored.ts';

/** A synthetic upstream: an invented repository, tag, commit and files. */
const data = '{"territories":{"QM":"Sample"}}';
const license = 'SAMPLE LICENSE';
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const commit = 'a'.repeat(40);
const entry: VendoredEntry = {
  repository: 'example-org/sample-data',
  tag: '1.0.0',
  commit,
  path: 'main/en/territories.json',
  sha256: sha256(data),
  licensePath: 'LICENSE',
  licenseSha256: sha256(license),
  license: 'Sample-1.0',
};
const sources = [
  {
    repository: entry.repository,
    licenses: [{ license: entry.license, sha256: entry.licenseSha256 }],
  },
];

describe('entryProblems', () => {
  it('accepts a well-formed entry with a pinned license', () => {
    expect(entryProblems(entry, sources)).toEqual([]);
  });

  it.each<[string, Partial<Record<keyof VendoredEntry, string>>, string]>([
    [
      'a path with ..',
      { path: 'main/../secrets' },
      'has a path that is not plain relative segments',
    ],
    [
      'a path with %2e',
      { path: 'main/%2e%2e/x' },
      'has a path that is not plain relative segments',
    ],
    ['an absolute path', { path: '/main/x' }, 'has a path that is not plain relative segments'],
    [
      'a path with a query',
      { path: 'main/x?ref=dev' },
      'has a path that is not plain relative segments',
    ],
    [
      'a license path with a backslash',
      { licensePath: 'a\\b' },
      'has a licensePath that is not plain relative segments',
    ],
    [
      'a traversing tag',
      { tag: '1.0..0' },
      'has a tag outside [A-Za-z0-9][A-Za-z0-9._-]* or with ".."',
    ],
    ['the tag *', { tag: '*' }, 'has a tag outside [A-Za-z0-9][A-Za-z0-9._-]* or with ".."'],
    [
      'a tag that is a ref path',
      { tag: 'refs/heads/main' },
      'has a tag outside [A-Za-z0-9][A-Za-z0-9._-]* or with ".."',
    ],
    ['a short commit', { commit: 'abc123' }, 'has a commit that is not 40 hex digits'],
    [
      'an uppercase hash',
      { sha256: entry.sha256.toUpperCase() },
      'has a sha256 that is not 64 hex digits',
    ],
    [
      'another repository',
      { repository: 'someone/fork' },
      'names a repository not in vendored-sources.json',
    ],
    [
      'another license',
      { license: 'MIT' },
      'has a license and license hash not pinned in vendored-sources.json',
    ],
  ])('refuses %s', (_, change, problem) => {
    expect(entryProblems({ ...entry, ...change }, sources)).toContain(problem);
  });

  it('refuses extra or missing keys', () => {
    expect(entryProblems({ ...entry, ref: 'main' }, sources)).toEqual([
      'has exactly the keys repository, tag, commit, path, sha256, licensePath, licenseSha256, license',
    ]);
  });
});

describe('rawUrl', () => {
  it('builds the URL of a file at the commit', () => {
    expect(rawUrl(entry, entry.path).href).toBe(
      `https://raw.githubusercontent.com/example-org/sample-data/${commit}/main/en/territories.json`,
    );
  });

  it('refuses a path the URL parser would rewrite', () => {
    expect(() => rawUrl(entry, 'main/../../other/repo/x')).toThrow('does not make a plain raw URL');
  });
});

describe('tagCommit', () => {
  const peeled = 'b'.repeat(40);

  it('prefers the peeled commit of an annotated tag', () => {
    expect(
      tagCommit(`${'c'.repeat(40)}\trefs/tags/1.0.0\n${peeled}\trefs/tags/1.0.0^{}\n`, '1.0.0'),
    ).toBe(peeled);
  });

  it('reads a lightweight tag', () => {
    expect(tagCommit(`${commit}\trefs/tags/1.0.0\n`, '1.0.0')).toBe(commit);
  });

  it.each([
    ['no match', ''],
    ['a branch named like the tag', `${commit}\trefs/heads/1.0.0\n`],
    ['a longer ref ending in the tag', `${commit}\trefs/tags/x/refs/tags/1.0.0\n`],
    ['an extra ref beside the tag', `${commit}\trefs/tags/1.0.0\n${commit}\trefs/tags/1.0.0-rc\n`],
    ['a malformed commit', `${commit.slice(1)}\trefs/tags/1.0.0\n`],
  ])('finds nothing in %s', (_, output) => {
    expect(tagCommit(output, '1.0.0')).toBeUndefined();
  });
});

describe('verifyEntry', () => {
  const upstream = (
    overrides: Partial<{ tagLine: string; files: Record<string, string> }> = {},
  ): Upstream => ({
    lsRemote: () => Promise.resolve(overrides.tagLine ?? `${commit}\trefs/tags/1.0.0\n`),
    download: (url) => {
      const files = overrides.files ?? { [entry.path]: data, [entry.licensePath]: license };
      const path = url.pathname.split(`/${commit}/`)[1] ?? '';
      return Promise.resolve(Buffer.from(files[path] ?? ''));
    },
  });

  it('accepts an entry whose tag and files match', async () => {
    expect(await verifyEntry(entry, upstream())).toEqual([]);
  });

  it('refuses a commit the tag does not name, such as one from a fork', async () => {
    expect(
      await verifyEntry(entry, upstream({ tagLine: `${'f'.repeat(40)}\trefs/tags/1.0.0\n` })),
    ).toEqual([`tag 1.0.0 of example-org/sample-data does not resolve to ${commit}`]);
  });

  it('refuses the tag head, which upstream does not have', async () => {
    expect(await verifyEntry({ ...entry, tag: 'head' }, upstream({ tagLine: '' }))).toEqual([
      `tag head of example-org/sample-data does not resolve to ${commit}`,
    ]);
  });

  it('refuses files with other hashes', async () => {
    const files = { [entry.path]: '{}', [entry.licensePath]: license };
    expect(await verifyEntry(entry, upstream({ files }))).toEqual([
      `${entry.path} at ${commit} hashes to ${sha256('{}')}`,
    ]);
  });
});
