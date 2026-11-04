import {
  dependencyFields,
  readManifests,
  readWorkspaceConfig,
  type Manifest,
  type Violation,
  type WorkspaceConfig,
} from './workspace.ts';
import { reportViolations } from './report.ts';

const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const allowedSpecifier = /^(?:catalog:(?:[a-z0-9-]+)?|workspace:\*)$/;

/** TypeScript 6.0 is for typescript-eslint only (spec 0001, R1). */
const lintCatalog = { specifier: 'catalog:lint', onlyFor: '@arca/eslint-config' } as const;

export function checkManifests(manifests: readonly Manifest[]): Violation[] {
  const violations: Violation[] = [];
  for (const manifest of manifests) {
    if (manifest.hasPnpmField) {
      violations.push({
        where: `${manifest.name} pnpm`,
        problem: 'pnpm settings belong in pnpm-workspace.yaml',
      });
    }
    for (const field of dependencyFields) {
      for (const [name, specifier] of Object.entries(manifest.dependencies[field])) {
        const where = `${manifest.name} ${field}.${name}`;
        if (!allowedSpecifier.test(specifier)) {
          violations.push({ where, problem: `"${specifier}" must be "catalog:" or "workspace:*"` });
        } else if (specifier === lintCatalog.specifier && manifest.name !== lintCatalog.onlyFor) {
          violations.push({
            where,
            problem: `only ${lintCatalog.onlyFor} may use the lint catalog`,
          });
        }
      }
    }
  }
  return violations;
}

export function checkWorkspaceConfig(config: WorkspaceConfig): Violation[] {
  const notExact = (where: string, version: string): Violation[] =>
    exactVersion.test(version) ? [] : [{ where, problem: `"${version}" is not an exact version` }];
  return [
    ...config.problems,
    ...[...config.catalogs].flatMap(([name, version]) => notExact(`catalog ${name}`, version)),
    // pnpm's `-` removes a dependency from the tree, which can only take code out.
    ...[...config.overrides]
      .filter(([, version]) => version !== '-')
      .flatMap(([name, version]) => notExact(`override ${name}`, version)),
  ];
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const config = await readWorkspaceConfig(rootDir);
  reportViolations([
    ...checkWorkspaceConfig(config),
    ...checkManifests(await readManifests(rootDir, config.packageRoots)),
  ]);
}

if (import.meta.main) await main();
