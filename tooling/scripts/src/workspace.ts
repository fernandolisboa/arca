import { readFile, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { parse } from 'yaml';
import { isRecord, whenMissing, type Violation } from './report.ts';

export type { Violation } from './report.ts';

export const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

export type DependencyField = (typeof dependencyFields)[number];

export interface Manifest {
  readonly dir: string;
  readonly name: string;
  readonly hasPnpmField: boolean;
  readonly dependencies: Readonly<Record<DependencyField, Readonly<Record<string, string>>>>;
}

export interface WorkspaceConfig {
  /** Directories from `packages:`, each written as `<dir>/*`. */
  readonly packageRoots: readonly string[];
  /** `<catalog>/<package>` → version; the default catalog is named `default`. */
  readonly catalogs: ReadonlyMap<string, string>;
  readonly overrides: ReadonlyMap<string, string>;
  /** `minimumReleaseAge`, in minutes; undefined when missing or invalid (invalid is also a problem). */
  readonly minimumReleaseAgeMinutes: number | undefined;
  /** `minimumReleaseAgeExclude`: names or `*` patterns, optionally with `@v1 || v2` exact versions. */
  readonly minimumReleaseAgeExclude: readonly string[];
  /** Entries in the sections above that do not have the expected shape. */
  readonly problems: readonly Violation[];
}

const listedRoot = /^([^*]+)\/\*$/;

/** Reads the parts of pnpm-workspace.yaml the scripts depend on, reporting any entry of another shape. */
export function parseWorkspaceYaml(text: string): WorkspaceConfig {
  const problems: Violation[] = [];
  const problem = (where: string, what: string) => {
    problems.push({ where: `pnpm-workspace.yaml ${where}`, problem: what });
  };
  const document: unknown = parse(text);
  const root = isRecord(document) ? document : {};

  const packageRoots: string[] = [];
  const packages = root['packages'];
  if (!Array.isArray(packages)) problem('packages', 'must be a list');
  else {
    for (const entry of packages as unknown[]) {
      const dir = typeof entry === 'string' ? listedRoot.exec(entry)?.[1] : undefined;
      if (dir === undefined)
        problem('packages', `${JSON.stringify(entry)} must be written as <dir>/*`);
      else packageRoots.push(dir);
    }
  }

  const stringMap = (where: string, value: unknown, into: Map<string, string>, prefix = '') => {
    if (value === undefined || value === null) return;
    if (!isRecord(value)) {
      problem(where, 'must be a map of package names to versions');
      return;
    }
    for (const [name, version] of Object.entries(value)) {
      if (typeof version === 'string') into.set(`${prefix}${name}`, version);
      else problem(`${where}.${name}`, 'must be a version string');
    }
  };

  const catalogs = new Map<string, string>();
  stringMap('catalog', root['catalog'], catalogs, 'default/');
  const named = root['catalogs'];
  if (named !== undefined && named !== null) {
    if (!isRecord(named)) problem('catalogs', 'must be a map of catalogs');
    else {
      for (const [name, entries] of Object.entries(named)) {
        stringMap(`catalogs.${name}`, entries, catalogs, `${name}/`);
      }
    }
  }
  const overrides = new Map<string, string>();
  stringMap('overrides', root['overrides'], overrides);

  const age = root['minimumReleaseAge'];
  const minimumReleaseAgeMinutes =
    typeof age === 'number' && Number.isInteger(age) && age >= 0 ? age : undefined;
  if (age !== undefined && minimumReleaseAgeMinutes === undefined) {
    problem('minimumReleaseAge', 'must be a non-negative integer of minutes');
  }
  const exclude = root['minimumReleaseAgeExclude'] ?? [];
  const minimumReleaseAgeExclude: string[] = [];
  if (!Array.isArray(exclude)) problem('minimumReleaseAgeExclude', 'must be a list');
  else {
    for (const entry of exclude as unknown[]) {
      if (typeof entry === 'string') minimumReleaseAgeExclude.push(entry);
      else problem('minimumReleaseAgeExclude', `${JSON.stringify(entry)} must be a string`);
    }
  }

  return {
    packageRoots,
    catalogs,
    overrides,
    minimumReleaseAgeMinutes,
    minimumReleaseAgeExclude,
    problems,
  };
}

export async function readWorkspaceConfig(rootDir: string): Promise<WorkspaceConfig> {
  return parseWorkspaceYaml(await readFile(join(rootDir, 'pnpm-workspace.yaml'), 'utf8'));
}

/** Reads the root manifest and one manifest per directory under each workspace root. */
export async function readManifests(
  rootDir: string,
  packageRoots: readonly string[],
): Promise<Manifest[]> {
  const dirs = [rootDir];
  for (const root of packageRoots) {
    const entries = await readdir(join(rootDir, root), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) dirs.push(join(rootDir, root, entry.name));
    }
  }
  const manifests: Manifest[] = [];
  for (const dir of dirs) {
    const raw = await readFile(join(dir, 'package.json'), 'utf8').catch(whenMissing(undefined));
    if (raw !== undefined) manifests.push(parseManifest(dir, raw));
  }
  return manifests;
}

export function parseManifest(dir: string, raw: string): Manifest {
  const json = JSON.parse(raw) as Record<string, unknown>;
  const name = typeof json['name'] === 'string' ? json['name'] : dir;
  const dependencies = Object.fromEntries(
    dependencyFields.map((field) => [field, stringRecord(json[field])]),
  ) as Manifest['dependencies'];
  return { dir, name, hasPnpmField: 'pnpm' in json, dependencies };
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

export function isToolingDir(rootDir: string, dir: string): boolean {
  return dir.startsWith(join(rootDir, 'tooling') + sep);
}
