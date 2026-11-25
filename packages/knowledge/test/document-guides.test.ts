import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCalendarDate } from '@arca/domain';
import { describe, expect, it } from 'vitest';
import { readDocumentGuides } from '../scripts/build.ts';

const guideFile = (number: number, verifiedAt = '2026-11-25') => ({
  schemaVersion: 1,
  number,
  officialDomains: ['gov.qm'],
  wordingSha256: '0'.repeat(64),
  sources: [
    {
      id: 'registry',
      url: 'https://www.registry.gov.qm/birth',
      title: 'Synthetic registry',
      kind: 'official',
      verifiedAt,
    },
  ],
  guides: [
    {
      country: 'QM',
      currency: 'BRL',
      entries: [{ kind: 'birth_certificate', sources: ['registry'] }],
    },
  ],
});

async function dirWith(files: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'document-guides-'));
  await Promise.all(
    Object.entries(files).map(([name, json]) => writeFile(join(dir, name), JSON.stringify(json))),
  );
  return dir;
}

const today = parseCalendarDate('2026-11-25');

describe('readDocumentGuides (ADR-0039)', () => {
  it('reads the highest-numbered file', async () => {
    const dir = await dirWith({ '1.json': guideFile(1), '2.json': guideFile(2) });
    expect(await readDocumentGuides(dir, today)).toMatchObject({ number: 2 });
  });

  it('refuses a file whose number is not its name', async () => {
    const dir = await dirWith({ '2.json': guideFile(1) });
    await expect(readDocumentGuides(dir, today)).rejects.toThrow(/carries number 1/);
  });

  it('refuses a file the schema refuses', async () => {
    const dir = await dirWith({
      '1.json': { ...guideFile(1), officialDomains: ['example.org'] },
    });
    await expect(readDocumentGuides(dir, today)).rejects.toThrow(/official domain/);
  });

  it('refuses a source verified after the build date', async () => {
    const dir = await dirWith({ '1.json': guideFile(1, '2026-11-26') });
    await expect(readDocumentGuides(dir, today)).rejects.toThrow(
      /document guide sources verified after 2026-11-25: registry/,
    );
  });

  it('is null without a file, as the repository has none until a guide is researched', async () => {
    expect(await readDocumentGuides(await dirWith({}), today)).toBeNull();
    expect(await readDocumentGuides(join(await dirWith({}), 'missing'), today)).toBeNull();
  });
});
