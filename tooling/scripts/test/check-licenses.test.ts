import { describe, expect, it } from 'vitest';
import {
  checkLicenses,
  licenseSatisfies,
  parseLicensePolicy,
  type LicensePolicy,
} from '../src/check-licenses.ts';
import type { RegistryRelease } from '../src/lockfile.ts';

const allow = ['MIT', 'Apache-2.0', 'BSD-3-Clause'];

describe('license expressions', () => {
  it.each([
    ['MIT', true],
    ['mit', true],
    ['GPL-3.0-only', false],
    ['(MIT OR GPL-3.0-only)', true],
    ['GPL-3.0-only OR Apache-2.0', true],
    ['MIT AND BSD-3-Clause', true],
    ['MIT AND GPL-3.0-only', false],
    ['(MIT AND (GPL-2.0-only OR Apache-2.0))', true],
    ['MIT AND GPL-2.0-only OR Apache-2.0', true],
    ['Apache-2.0 WITH LLVM-exception', false],
    ['MIT+', false],
    ['SEE LICENSE IN LICENSE.md', false],
    ['(MIT', false],
    ['MIT)', false],
    ['MIT OR', false],
    ['', false],
  ])('%s: %s', (expression, expected) => {
    expect(licenseSatisfies(expression, allow)).toBe(expected);
  });
});

describe('license policy', () => {
  it('reads allow and exceptions', () => {
    const policy = parseLicensePolicy(
      JSON.stringify({
        allow: ['MIT'],
        exceptions: [{ package: 'a*', license: 'MPL-2.0', reason: 'build tool' }],
      }),
    );
    expect(policy.allow).toEqual(['MIT']);
    expect(policy.exceptions).toHaveLength(1);
  });

  it.each([
    ['no allow list', { exceptions: [] }],
    ['an empty license id', { allow: [''], exceptions: [] }],
    ['an exception without a reason', { allow: [], exceptions: [{ package: 'a', license: 'X' }] }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseLicensePolicy(JSON.stringify(value))).toThrow();
  });
});

describe('license check', () => {
  const policy: LicensePolicy = {
    allow,
    exceptions: [{ package: 'lightningcss*', license: 'MPL-2.0', reason: 'build tool' }],
  };
  const release = (license: string | undefined): RegistryRelease => ({
    publishedAt: '2026-01-01T00:00:00Z',
    integrity: 'sha512-AAAA',
    license,
  });
  const check = (name: string, license: string | undefined) =>
    checkLicenses(
      [{ name, version: '1.0.0' }],
      new Map([[`${name}@1.0.0`, release(license)]]),
      policy,
    );

  it('accepts an allowed license and an excepted package', () => {
    expect(check('zod', 'MIT')).toEqual([]);
    expect(check('lightningcss-linux-x64-gnu', 'MPL-2.0')).toEqual([]);
  });

  it.each<[string, string, string | undefined, string]>([
    [
      'a disallowed license',
      'left-pad',
      'GPL-3.0-only',
      'has license GPL-3.0-only, which is not allowed',
    ],
    [
      'an exception for another license',
      'lightningcss',
      'GPL-3.0-only',
      'has license GPL-3.0-only, which is not allowed',
    ],
    [
      'an exception for another package',
      'other',
      'MPL-2.0',
      'has license MPL-2.0, which is not allowed',
    ],
    ['no license', 'zod', undefined, 'has no SPDX license on the registry'],
  ])('rejects %s', (_label, name, license, problem) => {
    expect(check(name, license)).toEqual([{ where: `${name}@1.0.0`, problem }]);
  });

  it('rejects a release the registry does not know', () => {
    expect(checkLicenses([{ name: 'zod', version: '9.9.9' }], new Map(), policy)).toEqual([
      { where: 'zod@9.9.9', problem: 'is not a release on the registry' },
    ]);
  });
});
