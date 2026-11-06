const durationPattern = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?$/;
const durationUnits = ['year', 'month', 'day'] as const;

export type DurationUnit = (typeof durationUnits)[number];

/** An ISO 8601 calendar duration's parts, largest first, without the zero ones; null if malformed. */
export function durationParts(
  value: string,
): readonly { readonly unit: DurationUnit; readonly count: number }[] | null {
  const match = durationPattern.exec(value);
  if (match === null) return null;
  return durationUnits.flatMap((unit, index) => {
    const count = Number(match[index + 1] ?? '0');
    return count === 0 ? [] : [{ unit, count }];
  });
}
