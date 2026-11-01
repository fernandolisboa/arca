import { describe, expect, it } from 'vitest';
import {
  addedPackages,
  checkReleaseAge,
  isExcluded,
  lockedPackageIds,
} from '../src/check-release-age.ts';

const lockfile = (...ids: string[]) =>
  [
    '---',
    "lockfileVersion: '9.0'",
    'packages:',
    "  '@pnpm/exe.linux-x64@12.15.0':",
    '    resolution: {integrity: sha512-AAAA}',
    '---',
    "lockfileVersion: '9.0'",
    'packages:',
    ...ids.flatMap((id) => [`  '${id}':`, '    resolution: {integrity: sha512-AAAA}']),
    'snapshots:',
    "  'ignored@1.0.0(peer@2.0.0)': {}",
  ].join('\n');

const now = new Date('2026-11-10T00:00:00Z');
const week = 7 * 1_440;
const options = { now, minimumAgeMinutes: week, exclude: [] as string[] };

describe('release age', () => {
  it('reads package ids from every lockfile document', () => {
    expect([...lockedPackageIds(lockfile('zod@4.6.7'))]).toEqual([
      '@pnpm/exe.linux-x64@12.15.0',
      'zod@4.6.7',
    ]);
  });

  it('judges only entries the change adds or changes', () => {
    expect(
      addedPackages(lockfile('zod@4.6.6', 'hono@4.13.14'), lockfile('zod@4.6.7', 'hono@4.13.14')),
    ).toEqual([{ name: 'zod', version: '4.6.7' }]);
    expect(addedPackages(lockfile('@scope/a@1.0.0'), lockfile('@scope/a@1.0.1'))).toEqual([
      { name: '@scope/a', version: '1.0.1' },
    ]);
  });

  it.each([
    ['zod', true],
    ['zod@4.6.7', true],
    ['zod@4.6.6', false],
    ['@hono/*', false],
    ['z*', true],
  ])('matches exclude entry %s: %s', (entry, expected) => {
    expect(isExcluded({ name: 'zod', version: '4.6.7' }, [entry])).toBe(expected);
  });

  it('accepts a release old enough', () => {
    const times = new Map([['zod@4.6.7', '2026-11-02T00:00:00Z']]);
    expect(checkReleaseAge([{ name: 'zod', version: '4.6.7' }], times, options)).toEqual([]);
  });

  it.each<[string, string | undefined, string]>([
    [
      'published 1 day ago',
      '2026-11-09T00:00:00Z',
      'was published 1.0 days ago; the minimum is 7 days',
    ],
    ['with no publish time', undefined, 'has no publish time on the registry'],
  ])('rejects a release %s', (_label, time, problem) => {
    const times = new Map([['zod@4.6.7', time]]);
    expect(checkReleaseAge([{ name: 'zod', version: '4.6.7' }], times, options)).toEqual([
      { where: 'zod@4.6.7', problem },
    ]);
  });

  it('rejects an entry that is not a registry version', () => {
    expect(
      checkReleaseAge([{ name: 'x', version: 'https://evil.test/x.tgz' }], new Map(), options),
    ).toEqual([{ where: 'x@https://evil.test/x.tgz', problem: 'is not a registry version' }]);
  });

  it('skips an entry excluded on the base branch', () => {
    const times = new Map([['zod@4.6.7', '2026-11-09T00:00:00Z']]);
    expect(
      checkReleaseAge([{ name: 'zod', version: '4.6.7' }], times, { ...options, exclude: ['zod'] }),
    ).toEqual([]);
  });
});
