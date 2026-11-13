import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const vercelJson = join(import.meta.dirname, '../../../apps/api/vercel.json');

const readVercelJson = async () =>
  JSON.parse(await readFile(vercelJson, 'utf8')) as {
    buildCommand: string;
    ignoreCommand: string;
  };

it('keeps the build command within the 256 characters Vercel accepts', async () => {
  const { buildCommand } = await readVercelJson();
  expect(buildCommand.length).toBeLessThanOrEqual(256);
  expect(buildCommand).toContain('@arca/scripts db:build');
});

it('builds production only and skips every preview, which share one database', async () => {
  const { ignoreCommand } = await readVercelJson();
  const skips = (vercelEnv: string) =>
    spawnSync('sh', ['-c', ignoreCommand], { env: { VERCEL_ENV: vercelEnv } }).status === 0;
  expect(skips('production')).toBe(false);
  expect(skips('preview')).toBe(true);
  expect(skips('')).toBe(true);
});
