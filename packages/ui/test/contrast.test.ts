import { describe, expect, it } from 'vitest';
import {
  type Palette,
  axes,
  highContrast,
  palettes,
  withHighContrast,
} from '../src/theme/index.js';

/** WCAG 2.x relative luminance of a `#RRGGBB` color. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

type Pair = readonly [foreground: keyof Palette, background: keyof Palette];

/** spec 0006, Color: Contrast pairs. */
const textPairs: readonly Pair[] = [
  ['ink', 'bg'],
  ['ink', 'surface'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['muted', 'soft'],
  ['primary', 'bg'],
  ['primary', 'surface'],
  ['primary', 'soft'],
  ['onPrimary', 'primary'],
  ['okInk', 'okBg'],
  ['warnInk', 'warnBg'],
  ['dangerInk', 'dangerBg'],
  ['dangerInk', 'bg'],
  ['dangerInk', 'surface'],
];

const cuePairs: readonly Pair[] = [
  ['line', 'bg'],
  ['line', 'surface'],
  ['second', 'bg'],
  ['second', 'surface'],
];

const cases = axes.theme.values.flatMap((theme) =>
  (['light', 'dark'] as const).map((mode) => ({ theme, mode })),
);

describe.each(cases)('$theme $mode', ({ theme, mode }) => {
  const palette = palettes[theme][mode];
  const high = withHighContrast(palette, highContrast[theme][mode]);

  it.each(textPairs)('%s on %s reaches 4.5:1', (foreground, background) => {
    expect(contrast(palette[foreground], palette[background])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(textPairs)('%s on %s reaches 7:1 with high contrast', (foreground, background) => {
    expect(contrast(high[foreground], high[background])).toBeGreaterThanOrEqual(7);
  });

  it.each(cuePairs)('%s on %s reaches 3:1 with high contrast', (foreground, background) => {
    expect(contrast(high[foreground], high[background])).toBeGreaterThanOrEqual(3);
  });
});

describe('contrast()', () => {
  it('matches known WCAG values', () => {
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });
});
