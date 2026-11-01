import { describe, expect, it } from 'vitest';
import { checkBoundaries } from '../src/check-boundaries.ts';
import { parseManifest, type Manifest } from '../src/workspace.ts';

const root = '/repo';

function manifest(dir: string, name: string, fields: Record<string, Record<string, string>> = {}) {
  return parseManifest(`${root}/${dir}`, JSON.stringify({ name, ...fields }));
}

const workspace: Manifest[] = [
  parseManifest(root, JSON.stringify({ name: 'arca' })),
  manifest('packages/domain', '@arca/domain'),
  manifest('packages/api-contract', '@arca/api-contract'),
  manifest('packages/ui', '@arca/ui'),
  manifest('packages/i18n', '@arca/i18n'),
  manifest('packages/platform', '@arca/platform'),
  manifest('packages/db', '@arca/db'),
  manifest('tooling/tsconfig', '@arca/tsconfig'),
  manifest('tooling/eslint-config', '@arca/eslint-config'),
];

function check(extra: Manifest) {
  return checkBoundaries([...workspace, extra], root);
}

describe('boundary matrix', () => {
  it('accepts the dependencies the matrix allows', () => {
    expect(
      check(
        manifest('apps/web', '@arca/web', {
          dependencies: {
            '@arca/api-contract': 'workspace:*',
            '@arca/ui': 'workspace:*',
            '@arca/i18n': 'workspace:*',
            '@arca/platform': 'workspace:*',
            react: 'catalog:',
          },
          devDependencies: { '@arca/tsconfig': 'workspace:*' },
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    ['apps/web', '@arca/web', 'dependencies', '@arca/domain'],
    ['apps/web', '@arca/web', 'devDependencies', '@arca/db'],
    ['apps/api', '@arca/api', 'peerDependencies', '@arca/ui'],
    ['packages/ui', '@arca/ui', 'optionalDependencies', '@arca/platform'],
    ['packages/domain', '@arca/domain', 'dependencies', '@arca/db'],
    ['packages/db', '@arca/db', 'devDependencies', '@arca/domain'],
  ])('rejects %s %s.%s on %s', (dir, name, field, dependency) => {
    expect(check(manifest(dir, name, { [field]: { [dependency]: 'workspace:*' } }))).toEqual([
      { where: `${name} ${field}.${dependency}`, problem: 'is not allowed by the boundary matrix' },
    ]);
  });

  it('rejects tooling outside devDependencies', () => {
    expect(
      check(
        manifest('packages/domain', '@arca/domain', {
          dependencies: { '@arca/tsconfig': 'workspace:*' },
        }),
      ),
    ).toHaveLength(1);
  });

  it('rejects tooling that depends on an app or package', () => {
    expect(
      check(
        manifest('tooling/scripts', '@arca/scripts', {
          devDependencies: { '@arca/domain': 'workspace:*' },
        }),
      ),
    ).toHaveLength(1);
  });

  it('rejects a package missing from the matrix', () => {
    expect(check(manifest('packages/extra', '@arca/extra'))).toHaveLength(1);
  });
});
