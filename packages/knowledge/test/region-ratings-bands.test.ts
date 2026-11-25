import { fileURLToPath } from 'node:url';
import { regionCountry, regionRatingsSchema, suggestedRatingsSchema } from '@arca/domain';
import { describe, expect, it } from 'vitest';
import { readRegionRatings, readSuggestedRatings } from '../scripts/build.ts';

/**
 * The bands of ADR-0035, which a region's stars follow too (ADR-0042): thresholds for 5, 4, 3 and
 * 2 stars, read as "at least" where higher is better and "at most" where lower is better.
 */
const numericBands: Readonly<Record<string, { cuts: readonly number[]; higher: boolean }>> = {
  climate: { cuts: [20, 15, 11, 7], higher: true },
  jobs: { cuts: [4, 6, 8, 11], higher: false },
  taxes: { cuts: [15, 25, 37, 48], higher: false },
  'brazilian-community': { cuts: [150000, 50000, 10000, 1000], higher: true },
  'housing-cost': { cuts: [60, 110, 160, 230], higher: false },
  'time-zone': { cuts: [1, 3, 5, 8], higher: false },
};

/** A co-official language beside Spanish scores below Spanish alone, the closer to Portuguese the higher. */
const tokenStars: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  language: { pt: 5, es: 4, en: 3, 'es-gl': 4, 'es-ca': 3, 'es-eu': 2 },
  'direct-flight': { direct: 5, connection: 2 },
};

function starsOf(value: number, { cuts, higher }: { cuts: readonly number[]; higher: boolean }) {
  const index = cuts.findIndex((cut) => (higher ? value >= cut : value <= cut));
  return index === -1 ? 1 : 5 - index;
}

const file = regionRatingsSchema.parse(
  await readRegionRatings(fileURLToPath(new URL('../regions', import.meta.url))),
);
const countries = suggestedRatingsSchema.parse(
  await readSuggestedRatings(fileURLToPath(new URL('../suggested-ratings', import.meta.url))),
);
const countryHousing = new Map(
  countries.criteria
    .find(({ id }) => id === 'housing-cost')
    ?.ratings.map(({ country, value }) => [country, Number(value)]),
);

describe('region ratings follow the bands of ADR-0035 (ADR-0042)', () => {
  it.each(file.criteria.map(({ id, ratings }) => [id, ratings] as const))('%s', (id, ratings) => {
    const bands = numericBands[id];
    const tokens = tokenStars[id];
    expect(bands !== undefined || tokens !== undefined, `no band for ${id}`).toBe(true);
    for (const { region, value, stars } of ratings) {
      // A region's housing value is a percentage of its country's level, so it scales the
      // country's price level before the band applies.
      const measured =
        id === 'housing-cost'
          ? ((countryHousing.get(regionCountry(region)) ?? Number.NaN) * Number(value)) / 100
          : Number(value);
      const expected = bands === undefined ? tokens?.[value] : starsOf(measured, bands);
      expect(stars, `${id} ${region} ${value}`).toBe(expected);
    }
  });

  it('covers only countries the country suggestions cover', () => {
    const known = new Set(
      countries.criteria.flatMap(({ ratings }) => ratings.map((r) => r.country)),
    );
    expect(file.regions.filter((region) => !known.has(regionCountry(region)))).toEqual([]);
  });
});
