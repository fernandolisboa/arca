import type { RouteResult } from '@arca/api-contract/client';

export type UnitsMoney = NonNullable<RouteResult['costs'][number]['min']>;

/** How a range of amounts reads: one amount, both bounds, one of them, or none known. */
export type AmountForm =
  | { readonly kind: 'exact'; readonly amount: UnitsMoney }
  | { readonly kind: 'range'; readonly min: UnitsMoney; readonly max: UnitsMoney }
  | { readonly kind: 'from'; readonly min: UnitsMoney }
  | { readonly kind: 'upTo'; readonly max: UnitsMoney }
  | { readonly kind: 'unknown' };

// A decimal string compared to zero only; amounts are never computed here.
const isZero = (money: UnitsMoney | null) => money !== null && Number(money.amount) === 0;

/** The form of a range as its bounds give it. */
export function rangeForm(min: UnitsMoney | null, max: UnitsMoney | null): AmountForm {
  if (min !== null && max !== null) {
    return min.amount === max.amount && min.currency === max.currency
      ? { kind: 'exact', amount: min }
      : { kind: 'range', min, max };
  }
  if (min !== null) return { kind: 'from', min };
  return max === null ? { kind: 'unknown' } : { kind: 'upTo', max };
}

/** The form of a total; a lower bound of zero says nothing, so a range from it reads "até". */
export function amountForm(min: UnitsMoney | null, max: UnitsMoney | null): AmountForm {
  return isZero(min) && !isZero(max) ? rangeForm(null, max) : rangeForm(min, max);
}

type Total = RouteResult['totals'][number];

/** Whether a range holds nothing at all: both bounds known and zero. */
const isNothing = ({ min, max }: Total['certain']) => isZero(min) && isZero(max);

/** A route's totals as the screen shows them: what is certain and what may come on top. */
export function shownTotals(totals: readonly Total[]): {
  readonly certain: readonly AmountForm[];
  readonly extra: readonly AmountForm[];
} {
  return {
    certain: totals
      .filter(({ certain }) => !isNothing(certain))
      .map(({ certain }) => amountForm(certain.min, certain.max)),
    extra: totals
      .filter(({ possibleExtra }) => !isNothing(possibleExtra))
      .map(({ possibleExtra }) => amountForm(possibleExtra.min, possibleExtra.max)),
  };
}
