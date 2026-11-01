import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { serializeOpenApiDocument } from '../src/server/index.js';

describe('openapi.json', () => {
  it('matches the routes; run `pnpm --filter @arca/api-contract openapi:write` after changing one', async () => {
    const committed = await readFile(new URL('../openapi.json', import.meta.url), 'utf8');
    expect(committed).toBe(serializeOpenApiDocument());
  });
});
