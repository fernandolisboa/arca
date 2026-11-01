import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkWebBundle } from '../src/check-web-bundle.ts';

async function dist(maps: Record<string, unknown>) {
  const dir = await mkdtemp(join(tmpdir(), 'arca-bundle-'));
  await mkdir(join(dir, 'assets'));
  for (const [name, content] of Object.entries(maps)) {
    await writeFile(join(dir, 'assets', name), JSON.stringify(content));
  }
  return dir;
}

describe('web bundle check', () => {
  it('passes a bundle of client modules', async () => {
    const dir = await dist({
      'index.js.map': {
        sources: [
          '../../src/main.tsx',
          '../../../../node_modules/.pnpm/react@19.3.1/node_modules/react/index.js',
        ],
      },
    });
    expect(await checkWebBundle(dir)).toEqual([]);
  });

  it.each([
    '../../../../node_modules/.pnpm/hono@4.13.14/node_modules/hono/dist/hono.js',
    '../../../../node_modules/.pnpm/@hono+zod-openapi@1.6.3/node_modules/@hono/zod-openapi/dist/index.js',
  ])('fails when the bundle includes %s', async (source) => {
    const dir = await dist({ 'index.js.map': { sources: ['../../src/main.tsx', source] } });
    expect(await checkWebBundle(dir)).toHaveLength(1);
  });

  it('fails when there are no source maps to verify', async () => {
    expect(await checkWebBundle(await dist({}))).toHaveLength(1);
  });
});
