import { fileURLToPath } from 'node:url';
import { suggestedRatingsSchema } from '@arca/domain';
import { describe, expect, it } from 'vitest';
import { readSuggestedRatings } from '../scripts/build.ts';
import { numericBands, starsOf, tokenStars } from './bands.ts';

const file = suggestedRatingsSchema.parse(
  await readSuggestedRatings(fileURLToPath(new URL('../suggested-ratings', import.meta.url))),
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
