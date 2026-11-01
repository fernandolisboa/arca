import { readFile } from 'node:fs/promises';
import { parseAllDocuments } from 'yaml';
import { escapeRegExp, isRecord, reportViolations, type Violation } from './report.ts';
import { parseWorkspaceYaml } from './workspace.ts';

export interface LockedPackage {
  readonly name: string;
  readonly version: string;
}

const registryVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** `packages:` keys from every document of a pnpm lockfile, as `name@version`. */
export function lockedPackageIds(lockfile: string): Set<string> {
  const ids = new Set<string>();
  for (const document of parseAllDocuments(lockfile)) {
    if (document.errors.length > 0) throw new Error('pnpm-lock.yaml is not valid YAML');
    const value: unknown = document.toJS();
    const packages = isRecord(value) ? value['packages'] : undefined;
    if (isRecord(packages)) for (const id of Object.keys(packages)) ids.add(id);
  }
  return ids;
}

export function splitPackageId(id: string): LockedPackage {
  const at = id.lastIndexOf('@');
  return at <= 0 ? { name: id, version: '' } : { name: id.slice(0, at), version: id.slice(at + 1) };
}

/** Lockfile entries in the change that are not in the base, which is what this check judges. */
export function addedPackages(baseLockfile: string, changedLockfile: string): LockedPackage[] {
  const base = lockedPackageIds(baseLockfile);
  return [...lockedPackageIds(changedLockfile)]
    .filter((id) => !base.has(id))
    .sort()
    .map(splitPackageId);
}

/** Matches pnpm's minimumReleaseAgeExclude entries: a name, `name@version`, or a name with `*`. */
export function isExcluded({ name, version }: LockedPackage, exclude: readonly string[]): boolean {
  return exclude.some((entry) => {
    if (entry === name || entry === `${name}@${version}`) return true;
    if (!entry.includes('*')) return false;
    const pattern = entry.split('*').map(escapeRegExp).join('.*');
    return new RegExp(`^${pattern}$`).test(name);
  });
}

export function checkReleaseAge(
  packages: readonly LockedPackage[],
  publishedAt: ReadonlyMap<string, string | undefined>,
  {
    now,
    minimumAgeMinutes,
    exclude,
  }: { now: Date; minimumAgeMinutes: number; exclude: readonly string[] },
): Violation[] {
  const violations: Violation[] = [];
  for (const entry of packages) {
    const where = `${entry.name}@${entry.version}`;
    if (isExcluded(entry, exclude)) continue;
    if (!registryVersion.test(entry.version)) {
      violations.push({ where, problem: 'is not a registry version' });
      continue;
    }
    const published = Date.parse(publishedAt.get(where) ?? '');
    if (Number.isNaN(published)) {
      violations.push({ where, problem: 'has no publish time on the registry' });
      continue;
    }
    const ageMinutes = (now.getTime() - published) / 60_000;
    if (ageMinutes < minimumAgeMinutes) {
      const days = (ageMinutes / 1_440).toFixed(1);
      violations.push({
        where,
        problem: `was published ${days} days ago; the minimum is ${String(minimumAgeMinutes / 1_440)} days`,
      });
    }
  }
  return violations;
}

async function publishTimes(packages: readonly LockedPackage[]): Promise<Map<string, string>> {
  const times = new Map<string, string>();
  const names = [...new Set(packages.map(({ name }) => name))];
  const fetchOne = async (name: string) => {
    const response = await fetch(`https://registry.npmjs.org/${name.replaceAll('/', '%2f')}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`registry answered ${String(response.status)} for ${name}`);
    const document = (await response.json()) as { time?: Record<string, unknown> };
    for (const [version, time] of Object.entries(document.time ?? {})) {
      if (typeof time === 'string') times.set(`${name}@${version}`, time);
    }
  };
  for (let index = 0; index < names.length; index += 8) {
    await Promise.all(names.slice(index, index + 8).map(fetchOne));
  }
  return times;
}

/**
 * Usage: check-release-age.ts <base pnpm-workspace.yaml> <base pnpm-lock.yaml> <changed pnpm-lock.yaml>
 *
 * Every lockfile entry the change adds must be at least minimumReleaseAge old, per the registry,
 * unless the base workspace excludes it. The base is main, so a change cannot exclude itself.
 */
async function main(): Promise<void> {
  const [workspacePath, baseLockPath, changedLockPath] = process.argv.slice(2);
  if (workspacePath === undefined || baseLockPath === undefined || changedLockPath === undefined) {
    throw new Error(
      'usage: check-release-age.ts <workspace yaml> <base lockfile> <changed lockfile>',
    );
  }
  const workspace = parseWorkspaceYaml(await readFile(workspacePath, 'utf8'));
  if (workspace.minimumReleaseAgeMinutes === undefined) {
    reportViolations([{ where: workspacePath, problem: 'has no minimumReleaseAge' }]);
    return;
  }
  const added = addedPackages(
    await readFile(baseLockPath, 'utf8'),
    await readFile(changedLockPath, 'utf8'),
  );
  const toLookUp = added.filter((entry) => !isExcluded(entry, workspace.minimumReleaseAgeExclude));
  console.log(
    `${String(added.length)} lockfile entries added; checking ${String(toLookUp.length)}`,
  );
  reportViolations(
    checkReleaseAge(added, await publishTimes(toLookUp), {
      now: new Date(),
      minimumAgeMinutes: workspace.minimumReleaseAgeMinutes,
      exclude: workspace.minimumReleaseAgeExclude,
    }),
  );
}

if (import.meta.main) await main();
