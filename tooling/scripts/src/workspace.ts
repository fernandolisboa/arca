import { readFile, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';

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

export interface Violation {
  readonly where: string;
  readonly problem: string;
}

export interface WorkspaceConfig {
  /** Directories from `packages:`, each written as `<dir>/*`. */
  readonly packageRoots: readonly string[];
  /** `<catalog>/<package>` → version; the default catalog is named `default`. */
  readonly catalogs: ReadonlyMap<string, string>;
  readonly overrides: ReadonlyMap<string, string>;
  /** Lines in the sections above that do not have the expected shape. */
  readonly problems: readonly Violation[];
}

const mapEntry =
  /^(?:'([^']+)'|"([^"]+)"|([^\s'":#{}[\]]+)):\s*(?:'([^']*)'|"([^"]*)"|([^\s'"#{}[\]]+))$/;
const listedRoot = /^- (?:'([^'*]+)\/\*'|"([^"*]+)\/\*"|([^\s'"#*]+)\/\*)$/;
const namedCatalog = /^([a-z0-9-]+):$/;

/**
 * Reads the parts of pnpm-workspace.yaml the scripts depend on. It accepts only the plain block
 * style this repository uses and reports anything else in those sections, so a line written in
 * another YAML style fails the check instead of being skipped.
 */
export function parseWorkspaceYaml(text: string): WorkspaceConfig {
  const packageRoots: string[] = [];
  const catalogs = new Map<string, string>();
  const overrides = new Map<string, string>();
  const problems: Violation[] = [];
  let section: string | undefined;
  let catalog = 'default';

  text.split('\n').forEach((line, index) => {
    const content = line.replace(/\s+#.*$/, '').trimEnd();
    const text = content.trim();
    if (text === '' || text.startsWith('#')) return;
    const indent = content.length - content.trimStart().length;
    const problem = () =>
      problems.push({
        where: `pnpm-workspace.yaml:${String(index + 1)}`,
        problem: 'unexpected line',
      });

    if (indent === 0) {
      const key = /^([A-Za-z]+):/.exec(text)?.[1];
      section = key;
      catalog = 'default';
      if (
        ['packages', 'catalog', 'catalogs', 'overrides'].includes(key ?? '') &&
        text !== `${key ?? ''}:`
      ) {
        problem();
      }
      return;
    }

    if (section === 'packages') {
      const match = listedRoot.exec(text);
      const root = match?.[1] ?? match?.[2] ?? match?.[3];
      if (indent !== 2 || root === undefined) problem();
      else packageRoots.push(root);
    } else if (section === 'catalogs' && indent === 2) {
      const name = namedCatalog.exec(text)?.[1];
      if (name === undefined) problem();
      else catalog = name;
    } else if (section === 'catalog' || section === 'catalogs' || section === 'overrides') {
      const expectedIndent = section === 'catalogs' ? 4 : 2;
      const match = mapEntry.exec(text);
      const name = match?.[1] ?? match?.[2] ?? match?.[3];
      const value = match?.[4] ?? match?.[5] ?? match?.[6];
      if (indent !== expectedIndent || name === undefined || value === undefined) problem();
      else if (section === 'overrides') overrides.set(name, value);
      else catalogs.set(`${catalog}/${name}`, value);
    }
  });

  return { packageRoots, catalogs, overrides, problems };
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
    const raw = await readFile(join(dir, 'package.json'), 'utf8').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
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
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

export function isToolingDir(rootDir: string, dir: string): boolean {
  return dir.startsWith(join(rootDir, 'tooling') + sep);
}

export function reportViolations(violations: readonly Violation[]): void {
  for (const { where, problem } of violations) console.error(`${where}: ${problem}`);
  process.exitCode = violations.length > 0 ? 1 : 0;
}
