/**
 * A check's cost as the screen shows it, to the cent: whole cents, or `under_cent` for a cost that
 * rounds to none but is not zero.
 */
export function shownCents(microUsd: number): number | 'under_cent' {
  const cents = Math.round(microUsd / 10_000);
  return cents === 0 && microUsd > 0 ? 'under_cent' : cents;
}
