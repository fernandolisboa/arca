import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCalendarDate, recognitionTracksSchema } from '@arca/domain';
import { describe, expect, it } from 'vitest';
import { readRecognitionTracks } from '../scripts/build.ts';
import { occupationCodes, recognitionTracks, studyFieldCodes } from '../src/index.js';

const repositoryDir = fileURLToPath(new URL('../recognition-tracks', import.meta.url));

describe('readRecognitionTracks (ADR-0040)', () => {
  it('reads the repository file, which the schema accepts', async () => {
    const json = await readRecognitionTracks(repositoryDir);
    expect(recognitionTracksSchema.safeParse(json).success).toBe(true);
  });

  it('refuses a file whose number is not its name', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'recognition-'));
    const json = await readRecognitionTracks(repositoryDir);
    await writeFile(join(dir, '2.json'), JSON.stringify(json));
    await expect(readRecognitionTracks(dir)).rejects.toThrow(/carries number 1/);
  });

  it('refuses a source verified after the build date', async () => {
    await expect(
      readRecognitionTracks(repositoryDir, parseCalendarDate('2026-11-24')),
    ).rejects.toThrow(/verified after 2026-11-24/);
  });

  it('is null without a file', async () => {
    expect(await readRecognitionTracks(await mkdtemp(join(tmpdir(), 'recognition-')))).toBeNull();
  });
});

describe('the shipped recognition tracks (ADR-0040)', () => {
  it('name only occupations and fields of study the classifications hold', () => {
    const occupations = new Set(occupationCodes);
    const fields = new Set(studyFieldCodes);
    expect(recognitionTracks.length).toBeGreaterThan(0);
    for (const track of recognitionTracks) {
      expect(track.occupations.filter((code) => !occupations.has(code))).toEqual([]);
      expect(track.studyFields.filter((code) => !fields.has(code))).toEqual([]);
    }
  });
});
