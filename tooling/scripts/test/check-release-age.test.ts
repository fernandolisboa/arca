import { describe, expect, it } from 'vitest';
import {
  addedPackages,
  checkReleaseAge,
  isExcluded,
  lockedPackages,
  type LockedPackage,
  type RegistryRelease,
} from '../src/check-release-age.ts';

const integrity = 'sha512-AAAA';

const entry = (id: string, resolution = `{integrity: ${integrity}}`) => [
  `  '${id}':`,
  `    resolution: ${resolution}`,
];

const lockfile = (...entries: string[][]) =>
  [
    '---',
    "lockfileVersion: '9.0'",
    'packages:',
    ...entry('@pnpm/exe.linux-x64@12.15.0'),
    '---',
    "lockfileVersion: '9.0'",
    'packages:',
    ...entries.flat(),
    'snapshots:',
    "  'ignored@1.0.0(peer@2.0.0)': {}",
  ].join('\n');

const zod: LockedPackage = { name: 'zod', version: '4.6.7', resolution: { integrity } };
const registry = (release: Partial<RegistryRelease>, id = 'zod@4.6.7') =>
  new Map<string, RegistryRelease>([
    [id, { publishedAt: '2026-11-02T00:00:00Z', integrity, ...release }],
  ]);

const now = new Date('2026-11-10T00:00:00Z');
const week = 7 * 1_440;
const options = { now, minimumAgeMinutes: week, exclude: [] as string[] };

describe('release age', () => {
  it('reads package entries from every lockfile document', () => {
    expect([...lockedPackages(lockfile(entry('zod@4.6.7')))]).toEqual([
      ['@pnpm/exe.linux-x64@12.15.0', { integrity }],
      ['zod@4.6.7', { integrity }],
    ]);
  });

  it('judges only entries the change adds or whose resolution it changes', () => {
    expect(
      addedPackages(
        lockfile(entry('zod@4.6.6'), entry('hono@4.13.14')),
        lockfile(entry('zod@4.6.7'), entry('hono@4.13.14')),
      ),
    ).toEqual([zod]);
    expect(
      addedPackages(lockfile(entry('@scope/a@1.0.0')), lockfile(entry('@scope/a@1.0.1'))),
    ).toEqual([{ name: '@scope/a', version: '1.0.1', resolution: { integrity } }]);
    expect(
      addedPackages(
        lockfile(entry('zod@4.6.7')),
        lockfile(entry('zod@4.6.7', '{integrity: sha512-BBBB}')),
      ),
    ).toEqual([{ ...zod, resolution: { integrity: 'sha512-BBBB' } }]);
  });

  it.each([
    ['zod', true],
    ['zod@4.6.7', true],
    ['zod@4.6.6', false],
    ['@hono/*', false],
    ['z*', true],
  ])('matches exclude entry %s: %s', (exclude, expected) => {
    expect(isExcluded(zod, [exclude])).toBe(expected);
  });

  it('accepts a registry release old enough', () => {
    expect(checkReleaseAge([zod], registry({}), options)).toEqual([]);
  });

  it.each<[string, LockedPackage, Map<string, RegistryRelease>, string]>([
    [
      'published 1 day ago',
      zod,
      registry({ publishedAt: '2026-11-09T00:00:00Z' }),
      'was published 1.0 days ago; the minimum is 7 days',
    ],
    [
      'with no publish time',
      zod,
      registry({ publishedAt: undefined }),
      'has no publish time on the registry',
    ],
    [
      'whose integrity differs from the registry',
      zod,
      registry({ integrity: 'sha512-BBBB' }),
      'has a lockfile integrity that differs from the registry',
    ],
    [
      'unknown to the registry',
      zod,
      new Map(),
      'has a lockfile integrity that differs from the registry',
    ],
    [
      'from a tarball URL',
      { ...zod, resolution: { integrity, tarball: 'https://evil.test/zod.tgz' } },
      registry({}),
      'does not resolve from the npm registry by integrity alone',
    ],
    [
      'with no integrity',
      { ...zod, resolution: { type: 'git', repo: 'https://evil.test/zod.git' } },
      registry({}),
      'does not resolve from the npm registry by integrity alone',
    ],
    [
      'with a version that is not a registry version',
      { ...zod, version: 'https://evil.test/x.tgz' },
      new Map(),
      'is not a registry version',
    ],
    [
      'with an invalid package name',
      { ...zod, name: '../../evil' },
      new Map(),
      'is not a valid package name',
    ],
  ])('rejects an entry %s', (_label, locked, releases, problem) => {
    expect(checkReleaseAge([locked], releases, options)).toEqual([
      { where: `${locked.name}@${locked.version}`, problem },
    ]);
  });

  it('skips only the age rule for an entry excluded on the base branch', () => {
    const young = registry({ publishedAt: '2026-11-09T00:00:00Z' });
    expect(checkReleaseAge([zod], young, { ...options, exclude: ['zod'] })).toEqual([]);
    const forged = registry({ publishedAt: '2026-11-09T00:00:00Z', integrity: 'sha512-BBBB' });
    expect(checkReleaseAge([zod], forged, { ...options, exclude: ['zod'] })).toEqual([
      { where: 'zod@4.6.7', problem: 'has a lockfile integrity that differs from the registry' },
    ]);
  });
});
