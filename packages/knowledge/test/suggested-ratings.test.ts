import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suggestedRatingsSchema } from '@arca/domain';
import { describe, expect, it } from 'vitest';
import { readSuggestedRatings } from '../scripts/build.ts';

const repositoryDir = fileURLToPath(new URL('../suggested-ratings', import.meta.url));

const minimal = (number: number) => ({
  schemaVersion: 1,
  number,
  sources: [
    {
      id: 'synthetic',
      url: 'https://example.org/',
      title: 'Synthetic',
      kind: 'official',
      verifiedAt: '2026-11-21',
    },
  ],
  criteria: [
    { id: 'climate', ratings: [{ country: 'QM', stars: 3, value: '1', source: 'synthetic' }] },
  ],
});

describe('readSuggestedRatings (ADR-0035)', () => {
  it('reads the repository file, which the schema accepts', async () => {
    const json = await readSuggestedRatings(repositoryDir);
    expect(suggestedRatingsSchema.safeParse(json).success).toBe(true);
  });

  it('reads the highest-numbered file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'suggested-'));
    await writeFile(join(dir, '1.json'), JSON.stringify(minimal(1)));
    await writeFile(join(dir, '2.json'), JSON.stringify(minimal(2)));
    expect(await readSuggestedRatings(dir)).toMatchObject({ number: 2 });
  });

  it('refuses a file whose number is not its name', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'suggested-'));
    await writeFile(join(dir, '3.json'), JSON.stringify(minimal(2)));
    await expect(readSuggestedRatings(dir)).rejects.toThrow(/carries number 2/);
  });

  it('is null without a file', async () => {
    expect(await readSuggestedRatings(await mkdtemp(join(tmpdir(), 'suggested-')))).toBeNull();
  });
});
