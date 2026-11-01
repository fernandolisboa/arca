import { parseAllDocuments } from 'yaml';
import { escapeRegExp, isRecord } from './report.ts';

export interface LockedPackage {
  readonly name: string;
  readonly version: string;
  /** The entry's `resolution`; a registry package has exactly `{ integrity }`. */
  readonly resolution: unknown;
}

export type PackageVersion = Pick<LockedPackage, 'name' | 'version'>;

/** What the npm registry says about one `name@version`. */
export interface RegistryRelease {
  readonly publishedAt: string | undefined;
  readonly integrity: string | undefined;
  /** The manifest's `license` when it is a string (an SPDX expression, normally). */
  readonly license: string | undefined;
}

const packageName = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[A-Za-z0-9~-][A-Za-z0-9._~-]*$/;

export function isValidPackageName(name: string): boolean {
  return packageName.test(name);
}

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

export function splitPackageId(id: string): PackageVersion {
  const at = id.lastIndexOf('@');
  return at <= 0 ? { name: id, version: '' } : { name: id.slice(0, at), version: id.slice(at + 1) };
}

/** Lockfile entries the change adds, or whose resolution it changes: what the policy checks judge. */
export function addedPackages(baseLockfile: string, changedLockfile: string): LockedPackage[] {
  const base = lockedPackages(baseLockfile);
  return [...lockedPackages(changedLockfile)]
    .filter(([id, resolution]) => JSON.stringify(base.get(id)) !== JSON.stringify(resolution))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, resolution]) => ({ ...splitPackageId(id), resolution }));
}

/**
 * Matches a package against pnpm's package selector grammar, as minimumReleaseAgeExclude uses it:
 * a name or a name pattern with `*`, optionally followed by `@` and exact versions separated by
 * `||` (`webpack@4.47.0 || 5.102.1`).
 */
export function matchesSelector({ name, version }: PackageVersion, selector: string): boolean {
  const at = selector.indexOf('@', 1);
  const namePattern = at === -1 ? selector : selector.slice(0, at);
  const versions = at === -1 ? undefined : selector.slice(at + 1).split('||');
  const pattern = namePattern.split('*').map(escapeRegExp).join('.*');
  return (
    new RegExp(`^${pattern}$`).test(name) &&
    (versions?.some((listed) => listed.trim() === version) ?? true)
  );
}

interface Packument {
  readonly time?: Record<string, unknown>;
  readonly versions?: Record<
    string,
    { readonly license?: unknown; readonly dist?: { readonly integrity?: unknown } }
  >;
}

/** Fetches the packument of every validly named package, eight at a time; a non-2xx throws. */
export async function registryReleases(
  packages: readonly PackageVersion[],
): Promise<Map<string, RegistryRelease>> {
  const releases = new Map<string, RegistryRelease>();
  const names = [...new Set(packages.map(({ name }) => name))].filter(isValidPackageName);
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  const fetchOne = async (name: string) => {
    const response = await fetch(`https://registry.npmjs.org/${name.replaceAll('/', '%2f')}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`registry answered ${String(response.status)} for ${name}`);
    const { time = {}, versions = {} } = (await response.json()) as Packument;
    for (const [version, manifest] of Object.entries(versions)) {
      releases.set(`${name}@${version}`, {
        publishedAt: text(time[version]),
        integrity: text(manifest.dist?.integrity),
        license: text(manifest.license),
      });
    }
  };
  for (let index = 0; index < names.length; index += 8) {
    await Promise.all(names.slice(index, index + 8).map(fetchOne));
  }
  return releases;
}
