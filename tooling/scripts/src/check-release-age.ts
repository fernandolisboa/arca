import { readFile } from 'node:fs/promises';
import {
  addedPackages,
  isValidPackageName,
  matchesSelector,
  registryReleases,
  type LockedPackage,
  type RegistryRelease,
} from './lockfile.ts';
import { isRecord, reportViolations, type Violation } from './report.ts';
import { parseWorkspaceYaml } from './workspace.ts';

const registryVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** The integrity of a plain registry resolution, or undefined for any other shape. */
function registryIntegrity(resolution: unknown): string | undefined {
  if (!isRecord(resolution)) return undefined;
  const keys = Object.keys(resolution);
  const integrity = resolution['integrity'];
  return keys.length === 1 && typeof integrity === 'string' ? integrity : undefined;
}

/**
 * Every judged entry must be a well-formed registry release whose lockfile integrity equals the
 * registry's, so the identity the age check vouches for is the artifact pnpm installs. Entries
 * the base branch excludes skip only the age rule.
 */
export function checkReleaseAge(
  packages: readonly LockedPackage[],
  registry: ReadonlyMap<string, RegistryRelease>,
  {
    now,
    minimumAgeMinutes,
    exclude,
  }: { now: Date; minimumAgeMinutes: number; exclude: readonly string[] },
): Violation[] {
  const violations: Violation[] = [];
  for (const entry of packages) {
    const where = `${entry.name}@${entry.version}`;
    const add = (problem: string) => violations.push({ where, problem });
    if (!isValidPackageName(entry.name)) {
      add('is not a valid package name');
      continue;
    }
    if (!registryVersion.test(entry.version)) {
      add('is not a registry version');
      continue;
    }
    const integrity = registryIntegrity(entry.resolution);
    if (integrity === undefined) {
      add('does not resolve from the npm registry by integrity alone');
      continue;
    }
    const release = registry.get(where);
    if (release?.integrity !== integrity) {
      add('has a lockfile integrity that differs from the registry');
      continue;
    }
    if (exclude.some((selector) => matchesSelector(entry, selector))) continue;
    const published = Date.parse(release.publishedAt ?? '');
    if (Number.isNaN(published)) {
      add('has no publish time on the registry');
      continue;
    }
    const ageMinutes = (now.getTime() - published) / 60_000;
    if (ageMinutes < minimumAgeMinutes) {
      const days = (ageMinutes / 1_440).toFixed(1);
      add(
        `was published ${days} days ago; the minimum is ${String(minimumAgeMinutes / 1_440)} days`,
      );
    }
  }
  return violations;
}

/**
 * Usage: check-release-age.ts <base pnpm-workspace.yaml> <base pnpm-lock.yaml> <changed pnpm-lock.yaml>
 *
 * Every lockfile entry the change adds or changes must match the registry's integrity and be at
 * least minimumReleaseAge old, unless the base workspace excludes it from the age rule. The base is
 * main, so a change cannot exclude itself.
 */
async function main(): Promise<void> {
  const [workspacePath, baseLockPath, changedLockPath] = process.argv.slice(2);
  if (workspacePath === undefined || baseLockPath === undefined || changedLockPath === undefined) {
    throw new Error(
      'usage: check-release-age.ts <workspace yaml> <base lockfile> <changed lockfile>',
    );
  }
  const workspace = parseWorkspaceYaml(await readFile(workspacePath, 'utf8'));
  if (workspace.problems.length > 0 || workspace.minimumReleaseAgeMinutes === undefined) {
    reportViolations([
      ...workspace.problems,
      ...(workspace.minimumReleaseAgeMinutes === undefined
        ? [{ where: workspacePath, problem: 'has no minimumReleaseAge' }]
        : []),
    ]);
    return;
  }
  const added = addedPackages(
    await readFile(baseLockPath, 'utf8'),
    await readFile(changedLockPath, 'utf8'),
  );
  console.log(`${String(added.length)} lockfile entries added or changed`);
  reportViolations(
    checkReleaseAge(added, await registryReleases(added), {
      now: new Date(),
      minimumAgeMinutes: workspace.minimumReleaseAgeMinutes,
      exclude: workspace.minimumReleaseAgeExclude,
    }),
  );
}

if (import.meta.main) await main();
