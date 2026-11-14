import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const vercelJson = join(import.meta.dirname, '../../../apps/api/vercel.json');

const readVercelJson = async () =>
  JSON.parse(await readFile(vercelJson, 'utf8')) as {
    buildCommand: string;
    ignoreCommand?: string;
    git: { deploymentEnabled: Record<string, boolean> };
  };

it('keeps the build command within the 256 characters Vercel accepts', async () => {
  const { buildCommand } = await readVercelJson();
  expect(buildCommand.length).toBeLessThanOrEqual(256);
  expect(buildCommand).toContain('@arca/scripts db:build');
});

it('deploys main only and skips every other branch, whose previews share one database', async () => {
  const { ignoreCommand, git } = await readVercelJson();
  expect(ignoreCommand).toBeUndefined();
  expect(git.deploymentEnabled).toEqual({ '**': false, main: true });
});
