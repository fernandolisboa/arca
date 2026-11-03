import { z } from 'zod';

const durationPattern = /^P(?:(\d{1,4})Y)?(?:(\d{1,5})M)?(?:(\d{1,6})D)?$/;

/** An ISO 8601 calendar duration, `PnYnMnD`, with at least one part and no time part. */
export const durationSchema = z
  .string()
  .regex(durationPattern)
  .refine((value) => value !== 'P', { message: 'A duration needs at least one part' })
  .brand<'Duration'>();

export type Duration = z.infer<typeof durationSchema>;

export interface DurationParts {
  readonly years: number;
  readonly months: number;
  readonly days: number;
}

export type DurationUnit = keyof DurationParts;

export function parseDuration(value: string): Duration {
  return durationSchema.parse(value);
}

export function durationParts(duration: Duration): DurationParts {
  const match = durationPattern.exec(duration);
  if (match === null) throw new RangeError('Not an ISO 8601 calendar duration');
  return {
    years: Number(match[1] ?? 0),
    months: Number(match[2] ?? 0),
    days: Number(match[3] ?? 0),
  };
}

/** The units a duration uses. A duration range uses a single unit, so its bounds always order. */
export function durationUnits(duration: Duration): DurationUnit[] {
  const parts = durationParts(duration);
  return (['years', 'months', 'days'] as const).filter((unit) => parts[unit] > 0);
}
