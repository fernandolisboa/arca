import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { axes, axisNames } from '../src/theme/ids.js';
import { fontPairs, palettes, radii } from '../src/theme/index.js';

describe('@arca/ui/theme/ids', () => {
  it('imports nothing, so the boot script never pulls in React or CSS', async () => {
    const source = await readFile(new URL('../src/theme/ids.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\bfrom\s+['"]/);
  });

  it.each(axisNames)('%s has its default among its values and unique values', (name) => {
    const axis = axes[name];
    expect(axis.values).toContain(axis.default);
    expect(new Set(axis.values).size).toBe(axis.values.length);
    expect(axis.attribute).toMatch(/^data-[a-z-]+$/);
  });

  it('has data for every theme, font pair and corner set', () => {
    expect(Object.keys(palettes).sort()).toEqual([...axes.theme.values].sort());
    expect(Object.keys(fontPairs).sort()).toEqual([...axes.font.values].sort());
    expect(Object.keys(radii).sort()).toEqual([...axes.corners.values].sort());
  });
});
