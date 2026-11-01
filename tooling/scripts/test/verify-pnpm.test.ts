import { describe, expect, it } from 'vitest';
import { comparePnpm, parsePackageManager, sriToSha512Hex } from '../src/verify-pnpm.ts';

const hex = 'ab'.repeat(64);
const sri = `sha512-${Buffer.from(hex, 'hex').toString('base64')}`;
const pinned = { version: '12.15.0', sha512Hex: hex };

describe('pnpm verification', () => {
  it('parses an exact packageManager with its hash', () => {
    expect(parsePackageManager(`pnpm@12.15.0+sha512.${hex}`)).toEqual(pinned);
  });

  it.each(['pnpm@12.15.0', 'pnpm@^12.15.0+sha512.ab', `yarn@4.0.0+sha512.${hex}`, undefined])(
    'rejects packageManager %s',
    (value) => {
      expect(parsePackageManager(value)).toBeUndefined();
    },
  );

  it('converts SRI to hex', () => {
    expect(sriToSha512Hex(sri)).toBe(hex);
    expect(sriToSha512Hex('sha1-abc')).toBeUndefined();
  });

  it('accepts a matching install', () => {
    expect(
      comparePnpm(pinned, {
        registryIntegrity: sri,
        tarballSha512Hex: hex,
        runningVersion: '12.15.0',
      }),
    ).toEqual([]);
  });

  it.each([
    [
      'registry integrity',
      { registryIntegrity: 'sha512-AAAA', tarballSha512Hex: hex, runningVersion: '12.15.0' },
    ],
    [
      'tarball',
      { registryIntegrity: sri, tarballSha512Hex: 'cd'.repeat(64), runningVersion: '12.15.0' },
    ],
    [
      'running version',
      { registryIntegrity: sri, tarballSha512Hex: hex, runningVersion: '12.14.0' },
    ],
  ])('fails on a different %s', (_label, observed) => {
    expect(comparePnpm(pinned, observed)).toHaveLength(1);
  });
});
