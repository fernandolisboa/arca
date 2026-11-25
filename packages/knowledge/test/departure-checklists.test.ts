import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { departureChecklistsSchema, parseCalendarDate } from '@arca/domain';
import { describe, expect, it } from 'vitest';
import { readDepartureChecklists } from '../scripts/build.ts';

const repositoryDir = fileURLToPath(new URL('../departure-checklists', import.meta.url));

describe('readDepartureChecklists (ADR-0038)', () => {
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

  it('refuses a source verified after the build date', async () => {
    await expect(
      readDepartureChecklists(repositoryDir, parseCalendarDate('2026-11-24')),
    ).rejects.toThrow(/verified after 2026-11-24/);
  });

  it('accepts a source verified on the build date', async () => {
    await expect(
      readDepartureChecklists(repositoryDir, parseCalendarDate('2026-11-25')),
    ).resolves.not.toBeNull();
  });

  it('is null without a file', async () => {
    expect(await readDepartureChecklists(await mkdtemp(join(tmpdir(), 'departure-')))).toBeNull();
  });
});
