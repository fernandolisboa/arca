import { describe, expect, it } from 'vitest';
import { renderThemesCss } from '../scripts/themes-css.js';

describe('themes.css', () => {
  it('matches the theme data; run `pnpm --filter @arca/ui themes` after changing it', async () => {
    await expect(renderThemesCss()).toMatchFileSnapshot('../src/themes.css');
  });
});
