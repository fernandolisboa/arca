import { fileURLToPath } from 'node:url';
import { regionCountry, regionRatingsSchema, suggestedRatingsSchema } from '@arca/domain';
import { describe, expect, it } from 'vitest';
import { readRegionRatings, readSuggestedRatings } from '../scripts/build.ts';
import { numericBands, starsOf, tokenStars } from './bands.ts';

/** A co-official language beside Spanish scores below Spanish alone, the closer to Portuguese the higher. */
const regionTokens: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  ...tokenStars,
  language: { ...tokenStars['language'], 'es-gl': 4, 'es-ca': 3, 'es-eu': 2 },
};

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
    const tokens = regionTokens[id];
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
