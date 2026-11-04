import { readFile } from 'node:fs/promises';
import { axes, axisNames } from '@arca/ui/theme/ids';
import { palettes } from '@arca/ui/theme';
import { describe, expect, it } from 'vitest';
import {
  applyPreferences,
  parsePreferences,
  resolvePreferences,
  serializePreferences,
} from '../src/appearance/preferences.js';

const defaults = Object.fromEntries(axisNames.map((axis) => [axis, axes[axis].default]));

function applied(raw: string | null) {
  const attributes: Record<string, string> = {};
  applyPreferences(
    {
      setAttribute: (name, value) => {
        attributes[name] = value;
      },
    },
    parsePreferences(raw),
  );
  return attributes;
}

const attributesOf = (values: Record<string, string>) =>
  Object.fromEntries(
    axisNames.map((axis) => [axes[axis].attribute, values[axis] ?? axes[axis].default]),
  );

describe('appearance preferences', () => {
  it('round-trips only the axes the person set', () => {
    const chosen = { theme: 'panel', navNarrow: 'fixed-dock', motion: 'on' } as const;
    expect(parsePreferences(serializePreferences(chosen))).toEqual(chosen);
  });

  it('resolves unset axes to their defaults', () => {
    expect(resolvePreferences({})).toEqual(defaults);
    expect(resolvePreferences({ mode: 'light' })).toEqual({ ...defaults, mode: 'light' });
  });

  it.each([
    ['nothing stored', null],
    ['not JSON', '{theme: panel'],
    ['another version', JSON.stringify({ v: 2, axes: { theme: 'panel' } })],
    ['no version', JSON.stringify({ axes: { theme: 'panel' } })],
    ['an array', JSON.stringify([{ v: 1 }])],
    ['axes as a string', JSON.stringify({ v: 1, axes: 'theme=panel' })],
  ])('falls back to every default with %s', (_case, raw) => {
    expect(parsePreferences(raw)).toEqual({});
    expect(applied(raw)).toEqual(attributesOf({}));
  });

  it('drops tampered and unknown values but keeps the valid ones', () => {
    const raw = JSON.stringify({
      v: 1,
      axes: {
        theme: '"><img src=x onerror=alert(1)>',
        mode: 'light',
        font: 'comic-sans',
        corners: ['round'],
        textSize: 150,
        motion: 'off',
        unknownAxis: 'x',
      },
    });
    expect(parsePreferences(raw)).toEqual({ mode: 'light', motion: 'off' });
    expect(applied(raw)).toEqual(attributesOf({ mode: 'light', motion: 'off' }));
  });

  it('ignores values inherited through the prototype', () => {
    const raw = '{"v":1,"axes":{"__proto__":{"theme":"panel"}}}';
    expect(parsePreferences(raw)).toEqual({});
  });

  it('sets only the fixed data-* attribute of each axis', () => {
    expect(Object.keys(applied(null)).sort()).toEqual(
      axisNames.map((axis) => axes[axis].attribute).sort(),
    );
  });
});

describe('index.html', () => {
  it('carries the default attributes and the default background as theme-color', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    for (const axis of axisNames) {
      expect(html).toContain(`${axes[axis].attribute}="${axes[axis].default}"`);
    }
    expect(html).toContain(
      `<meta name="theme-color" content="${palettes[axes.theme.default][axes.mode.default].bg}" />`,
    );
  });
});
