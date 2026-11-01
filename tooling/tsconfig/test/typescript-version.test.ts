import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const requireFromHere = createRequire(import.meta.url);
const tscBin = fileURLToPath(new URL('../node_modules/.bin/tsc', import.meta.url));
const fixture = fileURLToPath(
  new URL('./fixtures/strict-violations/tsconfig.json', import.meta.url),
);

describe('workspace compiler', () => {
  it('is TypeScript 7', () => {
    const { version } = requireFromHere('typescript/package.json') as { version: string };
    expect(version).toMatch(/^7\./);
  });

  it('enforces the shared strict flags', async () => {
    const result = await run(tscBin, ['-p', fixture]).then(
      () => ({ failed: false, stdout: '' }),
      (error: unknown) => ({
        failed: true,
        stdout: String((error as { stdout?: unknown }).stdout),
      }),
    );
    expect(result.failed).toBe(true);
    // noUncheckedIndexedAccess
    expect(result.stdout).toContain('TS2322');
    // exactOptionalPropertyTypes
    expect(result.stdout).toContain('TS2375');
  });
});
