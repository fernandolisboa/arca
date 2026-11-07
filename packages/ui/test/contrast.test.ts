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

const toLinear = (value: number) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const toGamma = (value: number) =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((offset) =>
    toLinear(Number.parseInt(hex.slice(offset, offset + 2), 16) / 255),
  ) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([lightness, a, b]: [number, number, number]): string {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${channels
    .map((channel) => Math.round(Math.min(1, Math.max(0, toGamma(channel))) * 255))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** `color-mix(in oklab, a weight, b)`, as the hover and pressed fills use it. */
function mix(a: string, weight: number, b: string): string {
  const [x, y] = [toOklab(a), toOklab(b)];
  const blend = (index: 0 | 1 | 2) => x[index] * weight + y[index] * (1 - weight);
  return fromOklab([blend(0), blend(1), blend(2)]);
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
  ['accent', 'bg'],
  ['accent', 'surface'],
  ['accent', 'soft'],
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

  it.each([0.88, 0.76])('onPrimary stays readable on primary mixed at %s', (weight) => {
    const fill = mix(palette.primary, weight, palette.primaryShift);
    expect(contrast(palette.onPrimary, fill)).toBeGreaterThanOrEqual(4.5);
    const highFill = mix(high.primary, weight, high.primaryShift);
    expect(contrast(high.onPrimary, highFill)).toBeGreaterThanOrEqual(7);
  });

  it('gives the pressed fill a visible step from primary', () => {
    expect(
      contrast(palette.primary, mix(palette.primary, 0.76, palette.primaryShift)),
    ).toBeGreaterThanOrEqual(1.1);
    expect(
      contrast(high.primary, mix(high.primary, 0.76, high.primaryShift)),
    ).toBeGreaterThanOrEqual(1.1);
  });

  it.each(cuePairs)('%s on %s reaches 3:1 with high contrast', (foreground, background) => {
    expect(contrast(high[foreground], high[background])).toBeGreaterThanOrEqual(3);
  });
});

describe('mix()', () => {
  it('matches color-mix in oklab at the ends and keeps grays gray', () => {
    expect(mix('#A8461F', 1, '#000000')).toBe('#a8461f');
    expect(mix('#A8461F', 0, '#FFFFFF')).toBe('#ffffff');
    const gray = mix('#000000', 0.5, '#FFFFFF');
    expect(gray.slice(1, 3)).toBe(gray.slice(3, 5));
  });
});

describe('contrast()', () => {
  it('matches known WCAG values', () => {
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });
});
