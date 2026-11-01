// Runs before pnpm exists, so it imports only node builtins and report.ts.
import { createHash } from 'node:crypto';
import { appendFile, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { escapeRegExp, reportViolations, type Violation } from './report.ts';

export interface PinnedPnpm {
  readonly version: string;
  readonly sha512Hex: string;
}

export interface ObservedPnpm {
  /** Integrity the lockfile records for `pnpm@<version>`. */
  readonly lockedPnpmIntegrity: string | undefined;
  /** Integrity the lockfile records for the platform's `@pnpm/exe.*` package. */
  readonly lockedExeIntegrity: string | undefined;
  readonly exeTarballSha512Hex: string;
  readonly hasBinary: boolean;
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

/**
 * Reads `resolution.integrity` for one package from the lockfile's first document, which holds
 * the package manager's own dependencies. A plain match keeps this script free of a YAML parser,
 * which is not installed yet; any other layout yields undefined and fails the check.
 */
export function lockedIntegrity(lockfile: string, packageId: string): string | undefined {
  const firstDocument = lockfile.split(/^---$/m).find((part) => part.trim() !== '') ?? '';
  const key = escapeRegExp(packageId);
  const entry = new RegExp(
    `^  '?${key}'?:\\n    resolution: \\{integrity: (sha512-[A-Za-z0-9+/]+=*)\\}$`,
    'm',
  );
  return entry.exec(firstDocument)?.[1];
}

/** Name of the `@pnpm/exe.*` package for a platform, as the lockfile lists it. */
export function exePackageName(platform: string, arch: string, musl: boolean): string {
  return `@pnpm/exe.${platform}-${arch}${musl ? '-musl' : ''}`;
}

/** Returns one file from an uncompressed ustar archive, which is what an npm tarball holds. */
export function tarEntry(archive: Buffer, path: string): Buffer | undefined {
  const block = 512;
  for (let offset = 0; offset + block <= archive.length;) {
    const header = archive.subarray(offset, offset + block);
    const field = (start: number, length: number) =>
      header.toString('utf8', start, start + length).replace(/\0[\s\S]*$/, '');
    const name = field(0, 100);
    if (name === '') return undefined;
    const prefix = field(345, 155);
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    const start = offset + block;
    if ((prefix === '' ? name : `${prefix}/${name}`) === path) {
      return archive.subarray(start, start + size);
    }
    offset = start + Math.ceil(size / block) * block;
  }
  return undefined;
}

export function checkPnpm(pinned: PinnedPnpm, observed: ObservedPnpm): Violation[] {
  const violations: Violation[] = [];
  const add = (problem: string) => violations.push({ where: `pnpm@${pinned.version}`, problem });
  if (sriToSha512Hex(observed.lockedPnpmIntegrity) !== pinned.sha512Hex) {
    add('lockfile integrity for pnpm differs from packageManager');
  }
  const lockedExe = sriToSha512Hex(observed.lockedExeIntegrity);
  if (lockedExe === undefined) add('lockfile has no integrity for the native binary package');
  else if (observed.exeTarballSha512Hex !== lockedExe) {
    add('downloaded native binary package differs from the lockfile');
  }
  if (!observed.hasBinary) add('native binary package has no package/pnpm');
  return violations;
}

const sha512Hex = (data: Buffer) => createHash('sha512').update(data).digest('hex');

function isMusl(): boolean {
  const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } };
  return process.platform === 'linux' && report.header?.glibcVersionRuntime === undefined;
}

/**
 * Installs the pnpm recorded in this repository without running anything unverified: the
 * packageManager hash must equal the lockfile's integrity for pnpm, and the platform's native
 * binary package must equal the lockfile's integrity for it. Only then is the binary written to
 * a directory that is put first on PATH for later steps (GITHUB_PATH) and printed.
 */
async function main(): Promise<void> {
  const root = process.cwd();
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    packageManager?: unknown;
  };
  const pinned = parsePackageManager(manifest.packageManager);
  if (pinned === undefined) {
    reportViolations([
      { where: 'package.json', problem: 'packageManager must be pnpm@x.y.z+sha512.<hex>' },
    ]);
    return;
  }
  const lockfile = await readFile(join(root, 'pnpm-lock.yaml'), 'utf8');
  const exeName = exePackageName(process.platform, process.arch, isMusl());
  const exeFile = `${exeName.slice('@pnpm/'.length)}-${pinned.version}.tgz`;
  const response = await fetch(`https://registry.npmjs.org/${exeName}/-/${exeFile}`);
  if (!response.ok) throw new Error(`${exeName} download failed: ${String(response.status)}`);
  const exeTarball = Buffer.from(await response.arrayBuffer());
  const binary = tarEntry(gunzipSync(exeTarball), 'package/pnpm');

  const violations = checkPnpm(pinned, {
    lockedPnpmIntegrity: lockedIntegrity(lockfile, `pnpm@${pinned.version}`),
    lockedExeIntegrity: lockedIntegrity(lockfile, `${exeName}@${pinned.version}`),
    exeTarballSha512Hex: sha512Hex(exeTarball),
    hasBinary: binary !== undefined,
  });
  reportViolations(violations);
  if (violations.length > 0 || binary === undefined) return;

  const binDir = join(process.env['RUNNER_TEMP'] ?? tmpdir(), `pnpm-${pinned.version}`);
  await mkdir(binDir, { recursive: true });
  const target = join(binDir, 'pnpm');
  await writeFile(target, binary);
  await chmod(target, 0o755);
  const githubPath = process.env['GITHUB_PATH'];
  if (githubPath !== undefined) await appendFile(githubPath, `${binDir}\n`);
  console.log(`pnpm ${pinned.version} verified and installed at ${target}`);
}

if (import.meta.main) await main();
