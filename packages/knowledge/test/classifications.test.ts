import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { occupationsFileSchema, studyFieldsFileSchema } from '../scripts/files.ts';

const read = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(new URL(`../data/${path}`, import.meta.url), 'utf8')) as unknown;

const sha256 = (codes: readonly string[]): string =>
  createHash('sha256').update(codes.join('\n')).digest('hex');

const countBy = (codes: readonly string[], prefix: number): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const code of codes) {
    const group = code.slice(0, prefix);
    counts[group] = (counts[group] ?? 0) + 1;
  }
  return counts;
};

/**
 * Each file against the official list it was taken from, as read on its source's `verifiedAt`:
 * the count per top-level group, and the SHA-256 of the codes in order, one per line. A new
 * version of a classification is a new numbered file with its own expectations here.
 */
describe('classification datasets', () => {
  it('holds the 436 ISCO-08 unit groups of the ILO structure', async () => {
    const file = occupationsFileSchema.parse(await read('occupations/1.json'));
    expect(file.codes).toHaveLength(436);
    expect(countBy(file.codes, 1)).toEqual({
      '0': 3,
      '1': 31,
      '2': 92,
      '3': 84,
      '4': 29,
      '5': 40,
      '6': 18,
      '7': 66,
      '8': 40,
      '9': 33,
    });
    expect(sha256(file.codes)).toBe(
      '6f167849a36496b3562809a7753b02378ccb38d3674178fa4c05ba79c7e17915',
    );
    expect(file.codes).toEqual([...file.codes].sort());
  });

  it('holds the 148 four-digit ISCED-F 2013 fields of the Eurostat code list', async () => {
    const file = studyFieldsFileSchema.parse(await read('study-fields/1.json'));
    expect(file.codes).toHaveLength(148);
    expect(countBy(file.codes, 2)).toEqual({
      '00': 5,
      '01': 7,
      '02': 19,
      '03': 13,
      '04': 13,
      '05': 19,
      '06': 6,
      '07': 20,
      '08': 10,
      '09': 17,
      '10': 19,
    });
    expect(sha256(file.codes)).toBe(
      '108c1cf5ede3c5ca32ec4fb17693515952b8af2f0d50987701fababd92cf863c',
    );
    expect(file.codes).toEqual([...file.codes].sort());
  });
});
