import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { reportViolations, type Violation } from './workspace.ts';

export interface PinnedPnpm {
  readonly version: string;
  readonly sha512Hex: string;
}

const packageManagerField = /^pnpm@(\d+\.\d+\.\d+)\+sha512\.([0-9a-f]{128})$/;

export function parsePackageManager(value: unknown): PinnedPnpm | undefined {
  const match = typeof value === 'string' ? packageManagerField.exec(value) : null;
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return { version: match[1], sha512Hex: match[2] };
}

/** Converts an SRI string (`sha512-<base64>`) to hex, or undefined if it is not SHA-512. */
export function sriToSha512Hex(integrity: unknown): string | undefined {
  if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) return undefined;
  return Buffer.from(integrity.slice('sha512-'.length), 'base64').toString('hex');
}

export function comparePnpm(
  pinned: PinnedPnpm,
  observed: { registryIntegrity: unknown; tarballSha512Hex: string; runningVersion: string },
): Violation[] {
  const violations: Violation[] = [];
  const where = `pnpm@${pinned.version}`;
  if (sriToSha512Hex(observed.registryIntegrity) !== pinned.sha512Hex) {
    violations.push({ where, problem: 'registry integrity differs from packageManager' });
  }
  if (observed.tarballSha512Hex !== pinned.sha512Hex) {
    violations.push({ where, problem: 'downloaded tarball differs from packageManager' });
  }
  if (observed.runningVersion !== pinned.version) {
    violations.push({
      where,
      problem: `pnpm on PATH is ${observed.runningVersion}, not ${pinned.version}`,
    });
  }
  return violations;
}

/**
 * Checks the pnpm in use against the hash recorded in packageManager. pnpm/action-setup installs
 * pnpm through `pnpm self-update`, which verifies the tarball against the registry's integrity
 * but not against our hash, so this step closes that gap.
 */
async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as {
    packageManager?: unknown;
  };
  const pinned = parsePackageManager(manifest.packageManager);
  if (pinned === undefined) {
    reportViolations([
      { where: 'package.json', problem: 'packageManager must be pnpm@x.y.z+sha512.<hex>' },
    ]);
    return;
  }
  const registry = 'https://registry.npmjs.org/pnpm';
  const metadata = (await (await fetch(`${registry}/${pinned.version}`)).json()) as {
    dist?: { integrity?: unknown; tarball?: unknown };
  };
  const tarball = await fetch(`${registry}/-/pnpm-${pinned.version}.tgz`);
  if (!tarball.ok) throw new Error(`tarball download failed: ${String(tarball.status)}`);
  const tarballSha512Hex = createHash('sha512')
    .update(Buffer.from(await tarball.arrayBuffer()))
    .digest('hex');
  const { stdout } = await promisify(execFile)('pnpm', ['--version']);
  reportViolations(
    comparePnpm(pinned, {
      registryIntegrity: metadata.dist?.integrity,
      tarballSha512Hex,
      runningVersion: stdout.trim(),
    }),
  );
}

if (import.meta.main) await main();
