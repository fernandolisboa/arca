import { readFile } from 'node:fs/promises';
import { suggestedRatingsSchema } from '@arca/domain';
import { describe, expect, it } from 'vitest';

/**
 * The bands of ADR-0035, by suggestion key: thresholds for 5, 4, 3 and 2 stars, read as "at least"
 * where higher is better and "at most" where lower is better; anything past the last is 1 star.
 */
const numericBands: Readonly<Record<string, { cuts: readonly number[]; higher: boolean }>> = {
  climate: { cuts: [20, 15, 11, 7], higher: true },
  schools: { cuts: [500, 485, 465, 420], higher: true },
  jobs: { cuts: [4, 6, 8, 11], higher: false },
  taxes: { cuts: [15, 25, 37, 48], higher: false },
  'distance-to-brazil': { cuts: [3000, 7000, 9500, 12000], higher: false },
  'brazilian-community': { cuts: [150000, 50000, 10000, 1000], higher: true },
  'housing-cost': { cuts: [60, 110, 160, 230], higher: false },
  'welcome-to-immigrants': { cuts: [75, 65, 55, 45], higher: true },
  stability: { cuts: [85, 75, 65, 55], higher: true },
  'time-zone': { cuts: [1, 3, 5, 8], higher: false },
  'public-transport': { cuts: [92, 85, 75, 50], higher: true },
  banking: { cuts: [97, 90, 80, 65], higher: true },
  outdoors: { cuts: [28, 21, 15, 8], higher: true },
};

const tokenStars: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  language: { pt: 5, es: 4, it: 4, en: 3, other: 1 },
  'direct-flight': { direct: 5, connection: 2 },
};

function starsOf(value: number, { cuts, higher }: { cuts: readonly number[]; higher: boolean }) {
  const index = cuts.findIndex((cut) => (higher ? value >= cut : value <= cut));
  return index === -1 ? 1 : 5 - index;
}

const file = suggestedRatingsSchema.parse(
  JSON.parse(await readFile(new URL('../suggested-ratings/1.json', import.meta.url), 'utf8')),
);

describe('suggested ratings follow the bands of ADR-0035', () => {
  it.each(file.criteria.map(({ id, ratings }) => [id, ratings] as const))('%s', (id, ratings) => {
    const bands = numericBands[id];
    const tokens = tokenStars[id];
    expect(bands !== undefined || tokens !== undefined, `no band for ${id}`).toBe(true);
    for (const { country, value, stars } of ratings) {
      const expected = bands === undefined ? tokens?.[value] : starsOf(Number(value), bands);
      expect(stars, `${id} ${country} ${value}`).toBe(expected);
    }
  });
});
