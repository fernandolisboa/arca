/** Three-valued (Kleene) truth: an absent fact is unknown, never false (spec 0002, R4). */
export type Truth = true | false | 'unknown';

export type ComparisonOperator = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';

/** A closed interval of possible values. A known value is an interval of one point. */
export interface Interval<T> {
  readonly min: T;
  readonly max: T;
}

export type Compare<T> = (left: T, right: T) => number;

/**
 * Compares two intervals: decided only when every pair of values they can take gives the same
 * answer. Intervals ignore links between operands, so a decided answer is never wrong but some
 * stay unknown.
 */
export function compareIntervals<T>(
  left: Interval<T>,
  operator: ComparisonOperator,
  right: Interval<T>,
  compare: Compare<T>,
): Truth {
  switch (operator) {
    case 'lt':
      return decide(compare(left.max, right.min) < 0, compare(left.min, right.max) >= 0);
    case 'lte':
      return decide(compare(left.max, right.min) <= 0, compare(left.min, right.max) > 0);
    case 'gt':
      return compareIntervals(right, 'lt', left, compare);
    case 'gte':
      return compareIntervals(right, 'lte', left, compare);
    case 'eq':
      return decide(
        compare(left.min, left.max) === 0 &&
          compare(right.min, right.max) === 0 &&
          compare(left.min, right.min) === 0,
        compare(left.max, right.min) < 0 || compare(right.max, left.min) < 0,
      );
    case 'ne':
      return not(compareIntervals(left, 'eq', right, compare));
  }
}

/** Kleene conjunction: false if any operand is false, true if all are true. */
export function and(values: readonly Truth[]): Truth {
  if (values.includes(false)) return false;
  return values.includes('unknown') ? 'unknown' : true;
}

/** Kleene disjunction: true if any operand is true, false if all are false. */
export function or(values: readonly Truth[]): Truth {
  if (values.includes(true)) return true;
  return values.includes('unknown') ? 'unknown' : false;
}

export function not(value: Truth): Truth {
  return value === 'unknown' ? 'unknown' : !value;
}

function decide(isTrue: boolean, isFalse: boolean): Truth {
  if (isTrue) return true;
  if (isFalse) return false;
  return 'unknown';
}
