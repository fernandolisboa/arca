import { readFile } from 'node:fs/promises';
import {
  addedPackages,
  matchesSelector,
  registryReleases,
  type PackageVersion,
  type RegistryRelease,
} from './lockfile.ts';
import { isRecord, reportViolations, type Violation } from './report.ts';

export interface LicenseException {
  /** A package selector, as in minimumReleaseAgeExclude. */
  readonly package: string;
  /** The exact license string the registry gives, so a relicense is judged again. */
  readonly license: string;
  readonly reason: string;
}

export interface LicensePolicy {
  /** SPDX license identifiers. */
  readonly allow: readonly string[];
  readonly exceptions: readonly LicenseException[];
}

export function parseLicensePolicy(json: string): LicensePolicy {
  const value: unknown = JSON.parse(json);
  const strings = (list: unknown) =>
    Array.isArray(list) && list.every((item) => typeof item === 'string' && item !== '');
  if (!isRecord(value) || !strings(value['allow']) || !Array.isArray(value['exceptions'])) {
    throw new Error('license policy needs an "allow" list of strings and an "exceptions" list');
  }
  const exceptions = value['exceptions'] as unknown[];
  for (const exception of exceptions) {
    if (
      !isRecord(exception) ||
      !strings([exception['package'], exception['license'], exception['reason']])
    ) {
      throw new Error('each license exception needs "package", "license" and "reason" strings');
    }
  }
  return {
    allow: value['allow'] as string[],
    exceptions: exceptions as LicenseException[],
  };
}

/**
 * Whether an SPDX expression is satisfied by the allowed identifiers: `OR` needs one side, `AND`
 * both. `WITH`, `+`, `LicenseRef-` and anything unparsable are not satisfied, so they need an
 * exception.
 */
export function licenseSatisfies(expression: string, allowed: readonly string[]): boolean {
  const ids = new Set(allowed.map((id) => id.toLowerCase()));
  const tokens = expression.match(/[()]|[^\s()]+/g) ?? [];
  let position = 0;
  const peek = () => tokens[position]?.toUpperCase();
  const parseAtom = (): boolean | undefined => {
    const token = tokens[position++];
    if (token === undefined || token === ')') return undefined;
    if (token !== '(')
      return ['AND', 'OR', 'WITH'].includes(token.toUpperCase())
        ? undefined
        : ids.has(token.toLowerCase());
    const inner = parseOr();
    return tokens[position++] === ')' ? inner : undefined;
  };
  const parseAnd = (): boolean | undefined => {
    let result = parseAtom();
    while (result !== undefined && peek() === 'AND') {
      position++;
      const right = parseAtom();
      result = right === undefined ? undefined : result && right;
    }
    return result;
  };
  const parseOr = (): boolean | undefined => {
    let result = parseAnd();
    while (result !== undefined && peek() === 'OR') {
      position++;
      const right = parseAnd();
      result = right === undefined ? undefined : result || right;
    }
    return result;
  };
  const result = parseOr();
  return result === true && position === tokens.length;
}

export function checkLicenses(
  packages: readonly PackageVersion[],
  registry: ReadonlyMap<string, RegistryRelease>,
  policy: LicensePolicy,
): Violation[] {
  const violations: Violation[] = [];
  for (const entry of packages) {
    const where = `${entry.name}@${entry.version}`;
    const release = registry.get(where);
    if (release === undefined) {
      violations.push({ where, problem: 'is not a release on the registry' });
      continue;
    }
    const { license } = release;
    if (license === undefined) {
      violations.push({ where, problem: 'has no SPDX license on the registry' });
      continue;
    }
    if (licenseSatisfies(license, policy.allow)) continue;
    const excepted = policy.exceptions.some(
      (exception) => exception.license === license && matchesSelector(entry, exception.package),
    );
    if (!excepted)
      violations.push({ where, problem: `has license ${license}, which is not allowed` });
  }
  return violations;
}

/**
 * Usage: check-licenses.ts <base licenses.json> <base pnpm-lock.yaml> <changed pnpm-lock.yaml>
 *
 * Every lockfile entry the change adds or changes must have, per the registry, a license the base
 * policy allows or excepts. The base is main, so a change cannot widen the list that judges it.
 */
async function main(): Promise<void> {
  const [policyPath, baseLockPath, changedLockPath] = process.argv.slice(2);
  if (policyPath === undefined || baseLockPath === undefined || changedLockPath === undefined) {
    throw new Error('usage: check-licenses.ts <license policy> <base lockfile> <changed lockfile>');
  }
  const policy = parseLicensePolicy(await readFile(policyPath, 'utf8'));
  const added = addedPackages(
    await readFile(baseLockPath, 'utf8'),
    await readFile(changedLockPath, 'utf8'),
  );
  console.log(`${String(added.length)} lockfile entries added or changed`);
  reportViolations(checkLicenses(added, await registryReleases(added), policy));
}

if (import.meta.main) await main();
