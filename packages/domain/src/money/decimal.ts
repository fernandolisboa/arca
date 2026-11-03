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

export function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/** Brings two exact values to the same scale. */
export function alignScales(left: Scaled, right: Scaled): [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.units * powerOfTen(scale - left.scale),
    right.units * powerOfTen(scale - right.scale),
    scale,
  ];
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
