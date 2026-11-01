import {
  dependencyFields,
  isToolingDir,
  readManifests,
  readWorkspaceConfig,
  type Manifest,
  type Violation,
} from './workspace.ts';
import { reportViolations } from './report.ts';

/** Which workspace packages each package may depend on (spec 0001, R2). */
export const allowedDependencies: Readonly<Record<string, readonly string[]>> = {
  '@arca/web': ['@arca/api-contract', '@arca/ui', '@arca/i18n', '@arca/platform'],
  '@arca/api': ['@arca/domain', '@arca/api-contract', '@arca/db'],
  '@arca/ui': ['@arca/i18n'],
  '@arca/domain': [],
  '@arca/api-contract': [],
  '@arca/platform': [],
  '@arca/i18n': [],
  '@arca/db': [],
};

export function checkBoundaries(manifests: readonly Manifest[], rootDir: string): Violation[] {
  const workspaceNames = new Set(manifests.map((manifest) => manifest.name));
  const toolingNames = new Set(
    manifests
      .filter((manifest) => isToolingDir(rootDir, manifest.dir))
      .map((manifest) => manifest.name),
  );
  const violations: Violation[] = [];

  for (const manifest of manifests) {
    if (manifest.dir === rootDir) continue;
    const isTooling = toolingNames.has(manifest.name);
    const allowed = allowedDependencies[manifest.name];
    if (!isTooling && allowed === undefined) {
      violations.push({
        where: manifest.name,
        problem: 'is not in the boundary matrix; add it to check-boundaries.ts and spec 0001 R2',
      });
      continue;
    }
    for (const field of dependencyFields) {
      for (const name of Object.keys(manifest.dependencies[field])) {
        if (!workspaceNames.has(name)) continue;
        const where = `${manifest.name} ${field}.${name}`;
        if (toolingNames.has(name)) {
          if (field !== 'devDependencies') {
            violations.push({
              where,
              problem: 'tooling packages are allowed in devDependencies only',
            });
          }
        } else if (isTooling || !(allowed ?? []).includes(name)) {
          violations.push({ where, problem: 'is not allowed by the boundary matrix' });
        }
      }
    }
  }
  return violations;
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const { packageRoots } = await readWorkspaceConfig(rootDir);
  reportViolations(checkBoundaries(await readManifests(rootDir, packageRoots), rootDir));
}

if (import.meta.main) await main();
