import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  checkPnpm,
  exePackageName,
  lockedIntegrity,
  parsePackageManager,
  shimTarget,
  sriToSha512Hex,
  tarEntry,
  type ObservedPnpm,
} from '../src/verify-pnpm.ts';

const hex = 'ab'.repeat(64);
const otherHex = 'cd'.repeat(64);
const sri = (value: string) => `sha512-${Buffer.from(value, 'hex').toString('base64')}`;
const pinned = { version: '12.15.0', sha512Hex: hex };

const lockfile = [
  '---',
  "lockfileVersion: '9.0'",
  '',
  'packages:',
  '',
  "  '@pnpm/exe.linux-x64@12.15.0':",
  `    resolution: {integrity: ${sri(otherHex)}}`,
  '    cpu: [x64]',
  '',
  '  pnpm@12.15.0:',
  `    resolution: {integrity: ${sri(hex)}}`,
  '',
  '---',
  'packages:',
  '',
  '  pnpm@12.15.0:',
  '    resolution: {integrity: sha512-AAAA}',
].join('\n');

function tarFile(path: string, content: string): Buffer {
  const header = Buffer.alloc(512);
  header.write(path, 0);
  header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124);
  const body = Buffer.alloc(Math.ceil(content.length / 512) * 512);
  body.write(content);
  return Buffer.concat([header, body]);
}

const matching: ObservedPnpm = {
  lockedPnpmIntegrity: sri(hex),
  lockedExeIntegrity: sri(otherHex),
  exeTarballSha512Hex: otherHex,
  expectedBinarySha512Hex: 'ef'.repeat(64),
  runningBinarySha512Hex: 'ef'.repeat(64),
  runningVersion: '12.15.0',
};

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
    expect(sriToSha512Hex(sri(hex))).toBe(hex);
    expect(sriToSha512Hex('sha1-abc')).toBeUndefined();
  });

  it('reads integrity from the package manager document of the lockfile only', () => {
    expect(lockedIntegrity(lockfile, 'pnpm@12.15.0')).toBe(sri(hex));
    expect(lockedIntegrity(lockfile, '@pnpm/exe.linux-x64@12.15.0')).toBe(sri(otherHex));
    expect(lockedIntegrity(lockfile, '@pnpm/exe.linux-arm64@12.15.0')).toBeUndefined();
  });

  it('names the native binary package per platform', () => {
    expect(exePackageName('linux', 'x64', false)).toBe('@pnpm/exe.linux-x64');
    expect(exePackageName('linux', 'arm64', true)).toBe('@pnpm/exe.linux-arm64-musl');
  });

  it('follows a cmd-shim to its target', () => {
    expect(shimTarget('#!/bin/sh\nexec "$basedir/x"\n# cmd-shim-target=/opt/pnpm/pnpm\n')).toBe(
      '/opt/pnpm/pnpm',
    );
    expect(shimTarget('\u007fELF')).toBeUndefined();
  });

  it('extracts one file from a tarball', () => {
    const archive = gzipSync(
      Buffer.concat([
        tarFile('package/package.json', '{}'),
        tarFile('package/pnpm', 'binary'),
        Buffer.alloc(1024),
      ]),
    );
    const tar = gunzipSync(archive);
    expect(tarEntry(tar, 'package/pnpm')?.toString()).toBe('binary');
    expect(tarEntry(tar, 'package/missing')).toBeUndefined();
  });

  it('accepts a matching install', () => {
    expect(checkPnpm(pinned, matching)).toEqual([]);
  });

  it.each<[string, Partial<ObservedPnpm>, string]>([
    [
      'lockfile pnpm integrity',
      { lockedPnpmIntegrity: sri(otherHex) },
      'lockfile integrity for pnpm differs from packageManager',
    ],
    [
      'missing native binary integrity',
      { lockedExeIntegrity: undefined },
      'lockfile has no integrity for the native binary package',
    ],
    [
      'native binary package',
      { exeTarballSha512Hex: hex },
      'downloaded native binary package differs from the lockfile',
    ],
    [
      'tarball without the binary',
      { expectedBinarySha512Hex: undefined },
      'native binary package has no package/pnpm',
    ],
    [
      'binary on PATH',
      { runningBinarySha512Hex: hex },
      'pnpm on PATH is not the native binary recorded in the lockfile',
    ],
    ['running version', { runningVersion: '12.14.0' }, 'pnpm on PATH is 12.14.0, not 12.15.0'],
  ])('fails on a different %s', (_label, change, problem) => {
    expect(checkPnpm(pinned, { ...matching, ...change })).toEqual([
      { where: 'pnpm@12.15.0', problem },
    ]);
  });
});
