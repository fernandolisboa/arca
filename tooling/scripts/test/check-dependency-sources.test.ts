import { describe, expect, it } from 'vitest';
import { checkManifests, checkWorkspaceConfig } from '../src/check-dependency-sources.ts';
import { parseManifest, parseWorkspaceYaml } from '../src/workspace.ts';

function manifest(name: string, fields: Record<string, unknown>) {
  return parseManifest(`/repo/${name}`, JSON.stringify({ name, ...fields }));
}

describe('dependency specifiers', () => {
  it('accepts catalog and workspace specifiers', () => {
    expect(
      checkManifests([
        manifest('@arca/x', {
          dependencies: { zod: 'catalog:' },
          devDependencies: { '@arca/tsconfig': 'workspace:*' },
        }),
        manifest('@arca/eslint-config', { dependencies: { typescript: 'catalog:lint' } }),
      ]),
    ).toEqual([]);
  });

  it.each([
    ['a range', '^1.2.3'],
    ['an exact version outside the catalog', '1.2.3'],
    ['a git source', 'github:owner/repo'],
    ['a tarball', 'https://example.test/x.tgz'],
    ['a loose workspace range', 'workspace:^'],
  ])('rejects %s', (_label, specifier) => {
    expect(
      checkManifests([manifest('@arca/x', { peerDependencies: { zod: specifier } })]),
    ).toHaveLength(1);
  });

  it('keeps the lint catalog to the ESLint config', () => {
    expect(
      checkManifests([
        manifest('@arca/domain', { devDependencies: { typescript: 'catalog:lint' } }),
      ]),
    ).toHaveLength(1);
  });

  it('rejects pnpm settings in package.json', () => {
    expect(checkManifests([manifest('arca', { pnpm: { overrides: {} } })])).toHaveLength(1);
  });
});

describe('pnpm-workspace.yaml', () => {
  const yaml = (...lines: string[]) => parseWorkspaceYaml(lines.join('\n'));

  it('reads roots, catalogs and overrides', () => {
    const config = yaml(
      'packages:',
      '  - apps/*',
      "  - 'tooling/*'",
      'savePrefix: ""',
      'catalog:',
      "  '@types/node': 26.6.5",
      '  zod: 4.6.7 # comment',
      'catalogs:',
      '  # comment',
      '  lint:',
      '    typescript: "6.0.3"',
      'overrides:',
      "  semver: '7.7.3'",
    );
    expect(config.packageRoots).toEqual(['apps', 'tooling']);
    expect([...config.catalogs]).toEqual([
      ['default/@types/node', '26.6.5'],
      ['default/zod', '4.6.7'],
      ['lint/typescript', '6.0.3'],
    ]);
    expect([...config.overrides]).toEqual([['semver', '7.7.3']]);
    expect(checkWorkspaceConfig(config)).toEqual([]);
  });

  it.each([
    ['a range in the catalog', ['catalog:', '  zod: ^4.6.7'], 'default/zod'],
    [
      'a range in a named catalog',
      ['catalogs:', '  lint:', '    typescript: ~6.0.3'],
      'lint/typescript',
    ],
    ['a range in overrides', ['overrides:', '  semver: ">=7"'], 'semver'],
    ['a flow mapping with a range', ['catalog: { zod: ^4.6.7 }'], 'default/zod'],
    [
      'a map where a version belongs',
      ['catalog:', '  zod: { version: 4.6.7 }'],
      'must be a version string',
    ],
    ['a list where a catalog belongs', ['catalogs:', '  lint: [typescript]'], 'must be a map'],
    ['a workspace root that is not dir/*', ['  - apps/**'], 'must be written as <dir>/*'],
  ])('rejects %s', (_label, lines, expected) => {
    const violations = checkWorkspaceConfig(yaml('packages:', '  - apps/*', ...lines));
    const messages = violations.map(({ where, problem }) => `${where}: ${problem}`);
    expect(messages).toEqual([expect.stringContaining(expected)]);
  });

  it('reads the release-age settings', () => {
    const config = yaml(
      'packages:',
      '  - apps/*',
      'minimumReleaseAge: 10080',
      'minimumReleaseAgeExclude:',
      '  - zod',
      "  - '@hono/*'",
    );
    expect(config.minimumReleaseAgeMinutes).toBe(10080);
    expect(config.minimumReleaseAgeExclude).toEqual(['zod', '@hono/*']);
    expect(
      yaml('packages:', '  - apps/*', 'minimumReleaseAge: soon').minimumReleaseAgeMinutes,
    ).toBeUndefined();
  });

  it('requires a packages list', () => {
    expect(checkWorkspaceConfig(yaml('catalog:', '  zod: 4.6.7'))).toEqual([
      { where: 'pnpm-workspace.yaml packages', problem: 'must be a list' },
    ]);
  });
});
