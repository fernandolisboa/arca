import { readFile } from 'node:fs/promises';
import { parseAllDocuments } from 'yaml';
import { escapeRegExp, isRecord, reportViolations, type Violation } from './report.ts';
import { parseWorkspaceYaml } from './workspace.ts';

export interface LockedPackage {
  readonly name: string;
  readonly version: string;
  /** The entry's `resolution`; a registry package has exactly `{ integrity }`. */
  readonly resolution: unknown;
}

/** What the npm registry says about one `name@version`. */
export interface RegistryRelease {
  readonly publishedAt: string | undefined;
  readonly integrity: string | undefined;
}

const registryVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const packageName = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[A-Za-z0-9~-][A-Za-z0-9._~-]*$/;

/** `packages:` entries from every document of a pnpm lockfile: `name@version` → `resolution`. */
export function lockedPackages(lockfile: string): Map<string, unknown> {
  const entries = new Map<string, unknown>();
  for (const document of parseAllDocuments(lockfile)) {
    if (document.errors.length > 0) throw new Error('pnpm-lock.yaml is not valid YAML');
    const value: unknown = document.toJS();
    const packages = isRecord(value) ? value['packages'] : undefined;
    if (!isRecord(packages)) continue;
    for (const [id, entry] of Object.entries(packages)) {
      entries.set(id, isRecord(entry) ? entry['resolution'] : undefined);
    }
  }
  return entries;
}

export function splitPackageId(id: string): Pick<LockedPackage, 'name' | 'version'> {
  const at = id.lastIndexOf('@');
  return at <= 0 ? { name: id, version: '' } : { name: id.slice(0, at), version: id.slice(at + 1) };
}

/**
 * Lockfile entries the change adds, or whose resolution it changes, which is what this check
 * judges.
 */
export function addedPackages(baseLockfile: string, changedLockfile: string): LockedPackage[] {
  const base = lockedPackages(baseLockfile);
  return [...lockedPackages(changedLockfile)]
    .filter(([id, resolution]) => JSON.stringify(base.get(id)) !== JSON.stringify(resolution))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, resolution]) => ({ ...splitPackageId(id), resolution }));
}

/** The integrity of a plain registry resolution, or undefined for any other shape. */
function registryIntegrity(resolution: unknown): string | undefined {
  if (!isRecord(resolution)) return undefined;
  const keys = Object.keys(resolution);
  const integrity = resolution['integrity'];
  return keys.length === 1 && typeof integrity === 'string' ? integrity : undefined;
}

/**
 * Matches pnpm's minimumReleaseAgeExclude entries: a name or a name pattern with `*`, optionally
 * followed by `@` and exact versions separated by `||` (`webpack@4.47.0 || 5.102.1`).
 */
export function isExcluded(
  { name, version }: Pick<LockedPackage, 'name' | 'version'>,
  exclude: readonly string[],
): boolean {
  return exclude.some((entry) => {
    const at = entry.indexOf('@', 1);
    const namePattern = at === -1 ? entry : entry.slice(0, at);
    const versions = at === -1 ? undefined : entry.slice(at + 1).split('||');
    const pattern = namePattern.split('*').map(escapeRegExp).join('.*');
    return (
      new RegExp(`^${pattern}$`).test(name) &&
      (versions?.some((listed) => listed.trim() === version) ?? true)
    );
  });
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
    if (!packageName.test(entry.name)) {
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
    if (isExcluded(entry, exclude)) continue;
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

interface Packument {
  readonly time?: Record<string, unknown>;
  readonly versions?: Record<string, { readonly dist?: { readonly integrity?: unknown } }>;
}

async function registryReleases(
  packages: readonly LockedPackage[],
): Promise<Map<string, RegistryRelease>> {
  const releases = new Map<string, RegistryRelease>();
  const names = [...new Set(packages.map(({ name }) => name))].filter((name) =>
    packageName.test(name),
  );
  const fetchOne = async (name: string) => {
    const response = await fetch(`https://registry.npmjs.org/${name.replaceAll('/', '%2f')}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`registry answered ${String(response.status)} for ${name}`);
    const { time = {}, versions = {} } = (await response.json()) as Packument;
    for (const [version, manifest] of Object.entries(versions)) {
      const publishedAt = time[version];
      const integrity = manifest.dist?.integrity;
      releases.set(`${name}@${version}`, {
        publishedAt: typeof publishedAt === 'string' ? publishedAt : undefined,
        integrity: typeof integrity === 'string' ? integrity : undefined,
      });
    }
  };
  for (let index = 0; index < names.length; index += 8) {
    await Promise.all(names.slice(index, index + 8).map(fetchOne));
  }
  return releases;
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
  if (workspace.minimumReleaseAgeMinutes === undefined) {
    reportViolations([{ where: workspacePath, problem: 'has no minimumReleaseAge' }]);
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
