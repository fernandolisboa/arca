import { describe, expect, it } from 'vitest';
import {
  addedPackages,
  lockedPackages,
  matchesSelector,
  type LockedPackage,
} from '../src/lockfile.ts';

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

describe('lockfile', () => {
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
    ['zod@4.6.6 || 4.6.7', true],
    ['zod@4.6.5 || 4.6.6', false],
    ['z*@4.6.7', true],
    ['z*@4.6.6', false],
  ])('matches selector %s: %s', (exclude, expected) => {
    expect(matchesSelector(zod, exclude)).toBe(expected);
  });

  it.each([
    ['@scope/a', true],
    ['@scope/*', true],
    ['@scope/*@1.0.0', true],
    ['@scope/a@1.0.0', true],
    ['@scope/a@1.0.1', false],
    ['@other/*', false],
  ])('matches scoped selector %s: %s', (exclude, expected) => {
    expect(matchesSelector({ name: '@scope/a', version: '1.0.0' }, exclude)).toBe(expected);
  });
});
