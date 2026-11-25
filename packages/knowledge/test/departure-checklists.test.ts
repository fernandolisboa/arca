import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { departureChecklistsSchema } from '@arca/domain';
import { describe, expect, it } from 'vitest';
import { readDepartureChecklists } from '../scripts/build.ts';

const repositoryDir = fileURLToPath(new URL('../departure-checklists', import.meta.url));

describe('readDepartureChecklists (ADR-0037)', () => {
  it('reads the repository file, which the schema accepts', async () => {
    const json = await readDepartureChecklists(repositoryDir);
    expect(departureChecklistsSchema.safeParse(json).success).toBe(true);
  });

  it('refuses a file whose number is not its name', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'departure-'));
    const json = await readDepartureChecklists(repositoryDir);
    await writeFile(join(dir, '2.json'), JSON.stringify(json));
    await expect(readDepartureChecklists(dir)).rejects.toThrow(/carries number 1/);
  });

  it('is null without a file', async () => {
    expect(await readDepartureChecklists(await mkdtemp(join(tmpdir(), 'departure-')))).toBeNull();
  });
});
