import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dependencyFields, readManifests, readWorkspaceConfig } from '../src/workspace.ts';

const rootDir = fileURLToPath(new URL('../../..', import.meta.url));

/** Model SDKs whose first use must also meet item 10 of the real-data gate. */
const modelSdks = [
  /^@anthropic-ai\//,
  /^openai$/,
  /^@google\/genai$/,
  /^@google\/generative-ai$/,
  /^@mistralai\//,
  /^cohere-ai$/,
  /^ai$/,
  /^@ai-sdk\//,
  /^langchain$/,
  /^@langchain\//,
  /^langfuse/,
];

const hookCreators = /\b(?:createHook|createWebhook|defineHook)\b/;
const skipped = new Set([
  'node_modules',
  'dist',
  'dev-dist',
  '.nitro',
  '.output',
  '.vercel',
  '.turbo',
  'test-results',
  'playwright-report',
]);

async function sources(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sources(path)));
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) found.push(path);
  }
  return found;
}

describe('surfaces the threat model counts as absent (docs/threat-models/foundations.md)', () => {
  it('keeps model SDKs to apps/api, whose extractor is off in production, so gate item 10 holds', async () => {
    const { packageRoots } = await readWorkspaceConfig(rootDir);
    const used = (await readManifests(rootDir, packageRoots)).flatMap((manifest) =>
      dependencyFields.flatMap((field) =>
        Object.keys(manifest.dependencies[field])
          .filter((name) => modelSdks.some((sdk) => sdk.test(name)))
          .map((name) => `${manifest.name}: ${name}`),
      ),
    );
    // apps/api/src/intake/environment.ts gives production no extractor until the evaluation
    // suite passes (spec 0008, ticket 4); another user must meet the item before it ships.
    expect(used.sort(), 'uncheck gate item 10 until this adapter meets it').toEqual([
      '@arca/api: @ai-sdk/anthropic',
      '@arca/api: ai',
    ]);
  });

  it('creates no workflow hook, so the public webhook route has nothing to resume', async () => {
    const files = [
      ...(await sources(join(rootDir, 'apps'))),
      ...(await sources(join(rootDir, 'packages'))),
    ];
    const creating: string[] = [];
    for (const file of files) {
      if (hookCreators.test(await readFile(file, 'utf8'))) creating.push(relative(rootDir, file));
    }
    expect(creating).toEqual([]);
  });
});
