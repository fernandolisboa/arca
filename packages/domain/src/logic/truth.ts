/** Three-valued (Kleene) truth: an absent fact is unknown, never false (spec 0002, R4). */
export type Truth = true | false | 'unknown';

export type ComparisonOperator = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';

/** A closed range of possible values. A known value is a range of one point. */
export interface Range<T> {
  readonly min: T;
  readonly max: T;
}

export type Compare<T> = (left: T, right: T) => number;

/**
 * Compares two ranges: decided only when every pair of values they can take gives the same answer.
 * Ranges ignore links between operands, so a decided answer is never wrong but some stay unknown.
 */
export function compareRanges<T>(
  left: Range<T>,
  operator: ComparisonOperator,
  right: Range<T>,
  compare: Compare<T>,
): Truth {
  switch (operator) {
    case 'lt':
      return decide(compare(left.max, right.min) < 0, compare(left.min, right.max) >= 0);
    case 'lte':
      return decide(compare(left.max, right.min) <= 0, compare(left.min, right.max) > 0);
    case 'gt':
      return compareRanges(right, 'lt', left, compare);
    case 'gte':
      return compareRanges(right, 'lte', left, compare);
    case 'eq':
      return decide(
        compare(left.min, left.max) === 0 &&
          compare(right.min, right.max) === 0 &&
          compare(left.min, right.min) === 0,
        compare(left.max, right.min) < 0 || compare(right.max, left.min) < 0,
      );
    case 'ne':
      return not(compareRanges(left, 'eq', right, compare));
  }
}

export function not(value: Truth): Truth {
  return value === 'unknown' ? 'unknown' : !value;
}

function decide(isTrue: boolean, isFalse: boolean): Truth {
  if (isTrue) return true;
  if (isFalse) return false;
  return 'unknown';
}
