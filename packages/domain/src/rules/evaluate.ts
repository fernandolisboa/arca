import { type CalendarDate, compareDates, elapsedSince } from '../calendar/calendar-date.js';
import type { Duration } from '../calendar/duration.js';
import {
  type FactBinding,
  type FactEnvironment,
  type FactType,
  type LineageBinding,
  deriveFact,
} from '../case/facts.js';
import { assertRecordedBy } from '../case/graph.js';
import { type MissingMarker, ancestorLines } from '../case/paths.js';
import type { Relationship } from '../case/snapshot.js';
import {
  addNumbers,
  compareNumbers,
  maxNumbers,
  minNumbers,
  multiplyNumber,
  orZero,
  subtractNumbers,
} from '../logic/number.js';
import { type Truth, and, compareIntervals, not, or } from '../logic/truth.js';
import {
  type BooleanValue,
  type NumberValue,
  type TokenListValue,
  type TokenValue,
  type Value,
  booleanValue,
  integerRange,
  unknownDate,
} from '../logic/value.js';
import type { CurrencyCode } from '../money/currency.js';
import { type Decimal, scaledDecimal } from '../money/decimal.js';
import { type CurrencyPair, type FxRate, convert } from '../money/fx.js';
import { type CollectionName, type Expression, isNonNegative } from './expression.js';
import { resolveFactReference } from './fact-reference.js';

/** A country set or a literal list of tokens. */
export interface SetValue {
  readonly type: 'set';
  readonly values: readonly string[];
}

export type Evaluated = Value | SetValue;

/** Where an expression is evaluated: who `person.*` is, and what else it can reach. */
export interface Frame {
  readonly environment: FactEnvironment;
  /** The date facts are read and edges crossed at: `factsAsOf`, or the rule's named date. */
  readonly at: CalendarDate;
  readonly referenceDates: ReadonlyMap<string, CalendarDate>;
  readonly countrySets: ReadonlyMap<string, readonly string[]>;
  readonly current: string;
  readonly edge?: Relationship;
  readonly lineage?: LineageBinding;
}

/**
 * One evaluated node: its value and its children, with the fact it read, the collection item it
 * stands for, and what was missing. The engine reads decisive missing facts from it (R5).
 */
export interface Trace {
  readonly op: Expression['op'] | 'item';
  readonly value: Evaluated;
  readonly children: readonly Trace[];
  readonly fact?: { readonly reference: string; readonly personId: string };
  /** A collection item; on a line of ancestors, the edges whose validity is unknown. */
  readonly item?: {
    readonly personId: string;
    readonly membership: Truth;
    readonly uncertainEdges?: readonly Relationship[];
  };
  /** A collection that may hold people who are not recorded, and the markers whose absence opens it. */
  readonly incomplete?: { readonly missingMarkers: readonly MissingMarker[] };
  /** On a fact, the completeness markers whose absence leaves its value open. */
  readonly missingMarkers?: readonly MissingMarker[];
  readonly missingRates?: readonly CurrencyPair[];
  readonly rates?: readonly FxRate[];
  readonly missingDate?: string;
}

/**
 * Evaluates a checked expression in Kleene logic over intervals (spec 0002, R4). A decided answer
 * is never wrong; what the snapshot does not settle stays unknown. The expression must have passed
 * `checkExpression` for this frame's scope.
 */
export function evaluate(expression: Expression, frame: Frame): Trace {
  switch (expression.op) {
    case 'bool':
      return leaf(expression.op, booleanValue(expression.value));
    case 'int':
      return leaf(expression.op, integerRange(expression.value, expression.value));
    case 'decimal': {
      const bound = scaled(expression.value);
      return leaf(expression.op, { type: 'number', min: bound, max: bound });
    }
    case 'money': {
      const bound = { units: BigInt(expression.amount), scale: 0 };
      const currency = expression.currency as CurrencyCode;
      return leaf(expression.op, { type: 'number', currency, min: bound, max: bound });
    }
    case 'date': {
      const date = expression.value as CalendarDate;
      return leaf(expression.op, { type: 'date', min: date, max: date });
    }
    case 'token':
      return leaf(expression.op, { type: 'token', value: expression.value });
    case 'tokens':
      return leaf(expression.op, { type: 'set', values: expression.values });
    case 'set':
      return leaf(expression.op, { type: 'set', values: pinnedSet(frame, expression.id) });
    case 'fact':
      return readFact(expression.key, expression.at, frame);
    case 'eq':
    case 'ne':
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      const left = evaluate(expression.left, frame);
      const right = evaluate(expression.right, frame);
      return node(expression.op, booleanValue(compare(left.value, expression.op, right.value)), [
        left,
        right,
      ]);
    }
    case 'in': {
      const item = evaluate(expression.item, frame);
      const set = evaluate(expression.set, frame);
      const token = item.value as TokenValue;
      const values = (set.value as SetValue).values;
      const truth: Truth = token.value === undefined ? 'unknown' : values.includes(token.value);
      return node(expression.op, booleanValue(truth), [item, set]);
    }
    case 'intersects': {
      const list = evaluate(expression.list, frame);
      const set = evaluate(expression.set, frame);
      const tokens = list.value as TokenListValue;
      const values = (set.value as SetValue).values;
      const truth: Truth = tokens.definite.some((token) => values.includes(token))
        ? true
        : tokens.complete && !tokens.possible.some((token) => values.includes(token))
          ? false
          : 'unknown';
      return node(expression.op, booleanValue(truth), [list, set]);
    }
    case 'all':
    case 'any': {
      const operands = expression.operands.map((operand) => evaluate(operand, frame));
      const truths = operands.map(truthOf);
      return node(
        expression.op,
        booleanValue(expression.op === 'all' ? and(truths) : or(truths)),
        operands,
      );
    }
    case 'not': {
      const operand = evaluate(expression.operand, frame);
      return node(expression.op, booleanValue(not(truthOf(operand))), [operand]);
    }
    case 'add':
    case 'sub': {
      const left = evaluate(expression.left, frame);
      const right = evaluate(expression.right, frame);
      const operation = expression.op === 'add' ? addNumbers : subtractNumbers;
      return node(expression.op, operation(numberOf(left), numberOf(right)), [left, right]);
    }
    case 'mul': {
      const operand = evaluate(expression.operand, frame);
      return node(expression.op, multiplyNumber(numberOf(operand), expression.by as Decimal), [
        operand,
      ]);
    }
    case 'min':
    case 'max': {
      const operands = expression.operands.map((operand) => evaluate(operand, frame));
      const operation = expression.op === 'min' ? minNumbers : maxNumbers;
      return node(expression.op, operation(operands.map(numberOf)), operands);
    }
    case 'convert':
      return convertTrace(evaluate(expression.operand, frame), expression.currency, frame);
    case 'since':
      return since(expression, frame);
    case 'count':
    case 'some':
    case 'every':
    case 'sum':
      return collection(expression, frame);
  }
}

/** The truth of a boolean trace. */
export function truthOf(trace: Trace): Truth {
  return (trace.value as BooleanValue).value;
}

function readFact(reference: string, dateName: string | undefined, frame: Frame): Trace {
  const resolved = resolveFactReference(reference);
  if (resolved === undefined) throw new RangeError('Unchecked fact reference');
  const binding = bindingFor(resolved.target, frame);
  const fact = { reference, personId: binding.personId };
  if (dateName !== undefined) {
    const date = frame.referenceDates.get(dateName);
    if (date === undefined) {
      const value = unknownOf(resolved.definition.type, frame.environment.currency);
      return { op: 'fact', value, children: [], fact, missingDate: dateName };
    }
    return factTrace(deriveFact(resolved.key, binding, date), fact);
  }
  return factTrace(deriveFact(resolved.key, binding, frame.at), fact);
}

function factTrace(
  derived: ReturnType<typeof deriveFact>,
  fact: { reference: string; personId: string },
): Trace {
  return {
    op: 'fact',
    value: derived.value,
    children: [],
    fact,
    ...(derived.missingRates === undefined ? {} : { missingRates: derived.missingRates }),
    ...(derived.rates === undefined ? {} : { rates: derived.rates }),
    ...(derived.missingMarkers === undefined ? {} : { missingMarkers: derived.missingMarkers }),
  };
}

function bindingFor(target: string, frame: Frame): FactBinding {
  const { environment } = frame;
  switch (target) {
    case 'principal':
      return { environment, personId: environment.principalId };
    case 'unit':
      return { environment, personId: environment.principalId };
    case 'ancestor': {
      const lineage = requireLineage(frame);
      const ancestor = lineage.path[0];
      if (ancestor === undefined) throw new RangeError('An empty line');
      return { environment, personId: ancestor, lineage: { path: lineage.path, position: 0 } };
    }
    default:
      return {
        environment,
        personId: frame.current,
        ...(frame.edge === undefined ? {} : { edge: frame.edge }),
        ...(frame.lineage === undefined ? {} : { lineage: frame.lineage }),
      };
  }
}

function requireLineage(frame: Frame): LineageBinding {
  if (frame.lineage === undefined) throw new RangeError('A lineage fact outside a line');
  return frame.lineage;
}

function compare(left: Evaluated, operator: Expression['op'], right: Evaluated): Truth {
  const op = operator as 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';
  if (left.type === 'number' && right.type === 'number') return compareNumbers(left, op, right);
  if (left.type === 'date' && right.type === 'date') {
    return compareIntervals(left, op, right, compareDates);
  }
  const equal = equalKnown(left, right);
  if (equal === 'unknown') return 'unknown';
  return op === 'eq' ? equal : !equal;
}

function equalKnown(left: Evaluated, right: Evaluated): Truth {
  if (left.type === 'boolean' && right.type === 'boolean') {
    return left.value === 'unknown' || right.value === 'unknown'
      ? 'unknown'
      : left.value === right.value;
  }
  if (left.type === 'token' && right.type === 'token') {
    return left.value === undefined || right.value === undefined
      ? 'unknown'
      : left.value === right.value;
  }
  throw new RangeError('Unchecked comparison');
}

function convertTrace(operand: Trace, currency: string, frame: Frame): Trace {
  const value = numberOf(operand);
  const to = currency as CurrencyCode;
  const from = value.currency;
  if (from === undefined) throw new RangeError('Unchecked conversion');
  const { fx, factsAsOf } = frame.environment;
  const missing: CurrencyPair[] = [];
  const rates: FxRate[] = [];
  const bound = (scaledBound: NumberValue['min']): NumberValue['min'] => {
    if (scaledBound === undefined) return undefined;
    const converted = convert({ ...scaledBound, currency: from }, to, fx, factsAsOf);
    if (converted.kind === 'missing_rate') {
      if (missing.length === 0) missing.push(converted.pair);
      return undefined;
    }
    if (converted.rate !== undefined && rates.length === 0) rates.push(converted.rate);
    return { units: converted.amount.units, scale: converted.amount.scale };
  };
  const min = bound(value.min);
  const max = bound(value.max);
  const converted: NumberValue =
    missing.length > 0
      ? { type: 'number', currency: to }
      : {
          type: 'number',
          currency: to,
          ...(min === undefined ? {} : { min }),
          ...(max === undefined ? {} : { max }),
        };
  return {
    op: 'convert',
    value: converted,
    children: [operand],
    ...(missing.length > 0 ? { missingRates: missing } : {}),
    ...(rates.length > 0 ? { rates } : {}),
  };
}

function since(expression: Extract<Expression, { op: 'since' }>, frame: Frame): Trace {
  const date = evaluate(expression.date, frame);
  const reference =
    expression.at === undefined ? frame.at : frame.referenceDates.get(expression.at);
  if (reference === undefined) {
    return {
      op: 'since',
      value: booleanValue('unknown'),
      children: [date],
      ...(expression.at === undefined ? {} : { missingDate: expression.at }),
    };
  }
  assertRecordedBy(frame.environment.snapshot, reference);
  const range = date.value as { min: CalendarDate; max: CalendarDate };
  const duration = expression.duration as Duration;
  const truth: Truth = elapsedSince(range.max, duration, reference)
    ? true
    : elapsedSince(range.min, duration, reference)
      ? 'unknown'
      : false;
  return node('since', booleanValue(truth), [date]);
}

interface Item {
  readonly frame: Frame;
  readonly membership: Truth;
  readonly uncertainEdges?: readonly Relationship[];
}

interface Counted {
  readonly membership: Truth;
  readonly condition: Truth;
  readonly value?: NumberValue;
}

type CollectionExpression = Extract<Expression, { op: 'count' | 'some' | 'every' | 'sum' }>;

function collection(expression: CollectionExpression, frame: Frame): Trace {
  const { items, complete, missingMarkers } = itemsOf(
    expression.over,
    expression.generations,
    frame,
  );
  const traces: Trace[] = [];
  const counted: Counted[] = [];
  for (const item of items) {
    const condition =
      expression.where === undefined ? undefined : evaluate(expression.where, item.frame);
    const value = expression.op === 'sum' ? evaluate(expression.value, item.frame) : undefined;
    const entry: Counted = {
      membership: item.membership,
      condition: condition === undefined ? true : truthOf(condition),
      ...(value === undefined ? {} : { value: numberOf(value) }),
    };
    counted.push(entry);
    traces.push({
      op: 'item',
      value: booleanValue(and([entry.membership, entry.condition])),
      children: [condition, value].filter((trace) => trace !== undefined),
      item: {
        personId: item.frame.current,
        membership: item.membership,
        ...(item.uncertainEdges === undefined ? {} : { uncertainEdges: item.uncertainEdges }),
      },
    });
  }
  return {
    op: expression.op,
    value: aggregate(expression, counted, complete, frame),
    children: traces,
    ...(complete ? {} : { incomplete: { missingMarkers } }),
  };
}

/**
 * Aggregates over items whose membership may be unknown. An incomplete collection may hold more
 * people: `some` can still become true, `every` false, and counts and sums grow.
 */
function aggregate(
  expression: CollectionExpression,
  counted: readonly Counted[],
  complete: boolean,
  frame: Frame,
): Value {
  const counts = counted.map((entry) => and([entry.membership, entry.condition]));
  switch (expression.op) {
    case 'some': {
      const truth = or(counts);
      return booleanValue(truth === true || complete ? truth : 'unknown');
    }
    case 'every': {
      const truth = and(counted.map((entry) => or([not(entry.membership), entry.condition])));
      return booleanValue(truth === false || complete ? truth : 'unknown');
    }
    case 'count': {
      const certain = counts.filter((truth) => truth === true).length;
      const possible = counts.filter((truth) => truth === 'unknown').length;
      return integerRange(certain, complete ? certain + possible : undefined);
    }
    case 'sum': {
      const zero = { units: 0n, scale: 0 };
      let total: NumberValue = { type: 'number', min: zero, max: zero };
      counted.forEach((entry, index) => {
        const truth = counts[index];
        if (truth === false || entry.value === undefined) return;
        total = addNumbers(total, truth === true ? entry.value : orZero(entry.value));
      });
      const currency = staticCurrency(expression.value, frame);
      const summed: NumberValue = { ...total, ...(currency === undefined ? {} : { currency }) };
      if (complete) return summed;
      const openAbove: NumberValue = withoutBound(summed, 'max');
      return isNonNegative(expression.value) ? openAbove : withoutBound(openAbove, 'min');
    }
  }
}

function itemsOf(
  over: CollectionName,
  generations: number | undefined,
  frame: Frame,
): { items: Item[]; complete: boolean; missingMarkers: readonly MissingMarker[] } {
  const { environment } = frame;
  const at = (current: string, lineage?: LineageBinding): Frame => {
    const { at: date, referenceDates, countrySets } = frame;
    return {
      environment,
      at: date,
      referenceDates,
      countrySets,
      current,
      ...(lineage === undefined ? {} : { lineage }),
    };
  };
  switch (over) {
    case 'unit.members':
    case 'unit.dependents': {
      const unit = environment.unit;
      if (unit === undefined) throw new RangeError('A unit collection before the unit is computed');
      const keep = (id: string): boolean =>
        over === 'unit.members' || id !== environment.principalId;
      return {
        items: [
          ...unit.included.filter(keep).map((id): Item => ({ frame: at(id), membership: true })),
          ...unit.possible
            .filter(keep)
            .map((id): Item => ({ frame: at(id), membership: 'unknown' })),
        ],
        complete: !unit.open,
        missingMarkers: unit.missingMarkers,
      };
    }
    case 'principal.ancestors': {
      if (generations === undefined) throw new RangeError('Unchecked ancestors collection');
      const { lines, missingMarkers } = ancestorLines(
        environment.snapshot,
        environment.principalId,
        generations,
        frame.at,
      );
      return {
        items: lines.map((line) => ({
          frame: at(line.path[0] ?? environment.principalId, { path: line.path, position: 0 }),
          membership: line.reached,
          uncertainEdges: line.uncertainEdges,
        })),
        complete: missingMarkers.length === 0,
        missingMarkers,
      };
    }
    case 'lineage.links': {
      const { path } = requireLineage(frame);
      const links = path.slice(1, -1).map((id, index) => ({
        frame: at(id, { path, position: index + 1 }),
        membership: true,
      }));
      return { items: links, complete: true, missingMarkers: [] };
    }
  }
}

function leaf(op: Expression['op'], value: Evaluated): Trace {
  return { op, value, children: [] };
}

function node(op: Expression['op'], value: Evaluated, children: readonly Trace[]): Trace {
  return { op, value, children };
}

function numberOf(trace: Trace): NumberValue {
  if (trace.value.type !== 'number') throw new RangeError('Unchecked arithmetic');
  return trace.value;
}

function scaled(value: string): { units: bigint; scale: number } {
  const bound = scaledDecimal(value as Decimal);
  return { units: bound.units, scale: bound.scale };
}

function pinnedSet(frame: Frame, id: string): readonly string[] {
  const set = frame.countrySets.get(id);
  if (set === undefined) throw new RangeError('A country set the version does not pin');
  return set;
}

function withoutBound(value: NumberValue, bound: 'min' | 'max'): NumberValue {
  const kept = bound === 'min' ? value.max : value.min;
  const other = bound === 'min' ? 'max' : 'min';
  return {
    type: 'number',
    ...(value.currency === undefined ? {} : { currency: value.currency }),
    ...(kept === undefined ? {} : { [other]: kept }),
  };
}

/** A wholly unknown value of a fact type. */
function unknownOf(type: FactType, currency: CurrencyCode): Value {
  switch (type.kind) {
    case 'boolean':
      return booleanValue('unknown');
    case 'integer':
      return { type: 'number' };
    case 'money':
      return { type: 'number', currency };
    case 'date':
      return unknownDate();
    case 'country':
    case 'enum':
      return { type: 'token' };
    case 'countries':
    case 'enum-list':
      return { type: 'tokens', definite: [], possible: [], complete: false };
  }
}

/**
 * The currency of a number expression, known statically, so an empty sum keeps it. Money facts are
 * in the version's currency.
 */
function staticCurrency(expression: Expression, frame: Frame): CurrencyCode | undefined {
  switch (expression.op) {
    case 'money':
    case 'convert':
      return expression.currency as CurrencyCode;
    case 'fact':
      return resolveFactReference(expression.key)?.definition.type.kind === 'money'
        ? frame.environment.currency
        : undefined;
    case 'add':
    case 'sub':
      return staticCurrency(expression.left, frame);
    case 'mul':
      return staticCurrency(expression.operand, frame);
    case 'min':
    case 'max':
      return expression.operands[0] === undefined
        ? undefined
        : staticCurrency(expression.operands[0], frame);
    case 'sum':
      return staticCurrency(expression.value, frame);
    default:
      return undefined;
  }
}
