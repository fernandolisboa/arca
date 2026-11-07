import { z } from 'zod';

const decimalPattern = /^(-?)(0|[1-9]\d{0,17})(?:\.(\d{1,12}))?$/;

/**
 * A decimal string with up to 12 fractional digits, for multipliers, shares and FX rates. Never a
 * floating-point number (spec 0002, R2).
 */
export const decimalSchema = z
  .string()
  .regex(decimalPattern)
  .refine((value) => !/^-0(?:\.0+)?$/.test(value), { message: 'Negative zero is not a decimal' })
  .brand<'Decimal'>();

export type Decimal = z.infer<typeof decimalSchema>;

/** An exact value: `units / 10^scale`. */
export interface Scaled {
  readonly units: bigint;
  readonly scale: number;
}

/** True for a well-formed decimal greater than zero; never throws on malformed input. */
export function isPositiveDecimal(value: string): boolean {
  const match = decimalPattern.exec(value);
  return match !== null && match[1] !== '-' && /[1-9]/.test(`${match[2] ?? ''}${match[3] ?? ''}`);
}

export function parseDecimal(value: string): Decimal {
  return decimalSchema.parse(value);
}

export function scaledDecimal(decimal: Decimal): Scaled {
  const match = decimalPattern.exec(decimal);
  if (match === null) throw new RangeError('Not a decimal');
  const fraction = match[3] ?? '';
  const magnitude = BigInt(`${match[2] ?? '0'}${fraction}`);
  return { units: match[1] === '-' ? -magnitude : magnitude, scale: fraction.length };
}

/** Scales stay small: each operation adds at most 12 digits and results are normalized. */
const maxScale = 1000;

export function powerOfTen(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > maxScale) {
    throw new RangeError('Scale out of range');
  }
  return 10n ** BigInt(exponent);
}

/** Brings exact values to one scale: the units of each, in order, and that scale. */
export function alignAll(values: readonly Scaled[]): { units: bigint[]; scale: number } {
  const scale = Math.max(0, ...values.map((value) => value.scale));
  return { units: values.map((value) => value.units * powerOfTen(scale - value.scale)), scale };
}

/** `n / d` rounded half to even, for a positive `d`. */
export function roundQuotientHalfEven(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new RangeError('The divisor is positive');
  const negative = n < 0n;
  const magnitude = negative ? -n : n;
  const quotient = magnitude / d;
  const twiceRemainder = (magnitude % d) * 2n;
  const roundsUp = twiceRemainder > d || (twiceRemainder === d && quotient % 2n === 1n);
  const rounded = roundsUp ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** An exact value as a decimal string, without trailing fraction zeros: 1500 at scale 3 is `1.5`. */
export function formatScaled({ units, scale }: Scaled): Decimal {
  const magnitude = units < 0n ? -units : units;
  const divisor = powerOfTen(scale);
  const whole = (magnitude / divisor).toString();
  const fraction = (magnitude % divisor).toString().padStart(scale, '0').replace(/0+$/, '');
  const sign = units < 0n ? '-' : '';
  return parseDecimal(`${sign}${fraction === '' ? whole : `${whole}.${fraction}`}`);
}

/** `n / d` rounded half-even to `places` decimal places, for a positive `d`. */
export function roundedDecimal(n: bigint, d: bigint, places: number): Decimal {
  return formatScaled({ units: roundQuotientHalfEven(n * powerOfTen(places), d), scale: places });
}

/** Brings two exact values to the same scale. */
export function alignScales(left: Scaled, right: Scaled): [bigint, bigint, number] {
  const {
    units: [a = 0n, b = 0n],
    scale,
  } = alignAll([left, right]);
  return [a, b, scale];
}

export function compareScaled(left: Scaled, right: Scaled): number {
  const [a, b] = alignScales(left, right);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Drops trailing zeros so repeated operations do not grow the scale. */
export function normalizeScaled({ units, scale }: Scaled): Scaled {
  let normalizedUnits = units;
  let normalizedScale = scale;
  while (normalizedScale > 0 && normalizedUnits % 10n === 0n) {
    normalizedUnits /= 10n;
    normalizedScale -= 1;
  }
  return { units: normalizedUnits, scale: normalizedScale };
}
