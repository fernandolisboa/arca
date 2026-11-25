import { z } from 'zod';
import { calendarDateSchema } from '../calendar/calendar-date.js';
import { durationSchema } from '../calendar/duration.js';
import { currencyCodeSchema } from '../money/currency.js';
import { type Decimal, decimalSchema, scaledDecimal } from '../money/decimal.js';
import type { FactKey, PersonRecord } from '../case/facts.js';
import type { Person } from '../case/snapshot.js';
import { resolveFactReference } from './fact-reference.js';

/** Identifiers inside knowledge files: requirement, source, cost and country set IDs. */
export const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

/** A named reference date from the context, such as `filingDate`. */
export const referenceDateNameSchema = z.string().regex(/^[a-z][a-zA-Z0-9]{0,31}$/);

/** A value of a catalog enumeration or a country code. */
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_]{1,40}$/);

/** A fact key with its binding prefix, such as `principal.ageYears`. */
export const factReferenceSchema = z
  .string()
  .max(80)
  .regex(/^[a-z][a-zA-Z]*(?:\.[a-z][a-zA-Z]*){1,2}$/);

export const collectionNames = [
  'unit.members',
  'unit.dependents',
  'principal.ancestors',
  'lineage.links',
  'person.workPeriods',
  'principal.workPeriods',
  'person.jobOffers',
  'principal.jobOffers',
  'person.residencePeriods',
  'principal.residencePeriods',
  'person.qualifications',
  'principal.qualifications',
  'person.registrations',
  'principal.registrations',
] as const;

export type CollectionName = (typeof collectionNames)[number];

/**
 * The collections over one person's records (ADR-0036): whose records (the person in focus or the
 * principal), the snapshot list they come from, the record each item binds, and, for records
 * that last a while, the facts that bound each item's period, which `covers` reads. An absent
 * list is unknown, `[]` none.
 */
const periods = <const List extends keyof Person, const Record extends PersonRecord['kind']>(
  list: List,
  record: Record,
) => ({ list, record, period: { start: `${record}.start`, end: `${record}.end` } }) as const;

const workPeriods = periods('workPeriods', 'workPeriod');
const residencePeriods = periods('residencePeriods', 'residencePeriod');
const qualifications = { list: 'qualifications', record: 'qualification' } as const;
const registrations = { list: 'registrations', record: 'registration' } as const;

const jobOffers = { list: 'jobOffers', record: 'jobOffer' } as const;

export const recordCollections = {
  'person.workPeriods': { owner: 'current', ...workPeriods },
  'principal.workPeriods': { owner: 'principal', ...workPeriods },
  'person.jobOffers': { owner: 'current', ...jobOffers },
  'principal.jobOffers': { owner: 'principal', ...jobOffers },
  'person.residencePeriods': { owner: 'current', ...residencePeriods },
  'principal.residencePeriods': { owner: 'principal', ...residencePeriods },
  'person.qualifications': { owner: 'current', ...qualifications },
  'principal.qualifications': { owner: 'principal', ...qualifications },
  'person.registrations': { owner: 'current', ...registrations },
  'principal.registrations': { owner: 'principal', ...registrations },
} as const satisfies Partial<
  Record<
    CollectionName,
    {
      readonly owner: 'current' | 'principal';
      readonly list: keyof Person;
      readonly record: PersonRecord['kind'];
      readonly period?: { readonly start: FactKey; readonly end: FactKey };
    }
  >
>;

export type RecordCollectionName = keyof typeof recordCollections;
export type RecordList = (typeof recordCollections)[RecordCollectionName]['list'];

export function isRecordCollection(name: CollectionName): name is RecordCollectionName {
  return Object.hasOwn(recordCollections, name);
}

/** The record collections whose items have a period, which `covers` can read. */
export type PeriodCollectionName = {
  [Name in RecordCollectionName]: (typeof recordCollections)[Name] extends { period: object }
    ? Name
    : never;
}[RecordCollectionName];

export function isPeriodCollection(name: CollectionName): name is PeriodCollectionName {
  return isRecordCollection(name) && 'period' in recordCollections[name];
}

export const maxAncestorGenerations = 4;
export const maxExpressionDepth = 16;
export const maxNodesPerVersion = 500;

export const comparisonOperators = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'] as const;

type Comparison = (typeof comparisonOperators)[number];

/**
 * The closed expression tree of a requirement, condition or cost (spec 0002, R4). It is data,
 * evaluated without `eval`, regular expressions or user code.
 */
export type Expression =
  | { readonly op: 'bool'; readonly value: boolean }
  /**
   * A branch of the law the version does not model, such as an exception the snapshot cannot
   * describe. It is always unknown, so whoever it decides stays possible, never wrongly settled.
   */
  | { readonly op: 'unmodeled' }
  | { readonly op: 'int'; readonly value: number }
  | { readonly op: 'decimal'; readonly value: string }
  | { readonly op: 'money'; readonly amount: number; readonly currency: string }
  | { readonly op: 'date'; readonly value: string }
  | { readonly op: 'token'; readonly value: string }
  | { readonly op: 'tokens'; readonly values: readonly string[] }
  | { readonly op: 'set'; readonly id: string }
  | { readonly op: 'fact'; readonly key: string; readonly at?: string | undefined }
  | { readonly op: Comparison; readonly left: Expression; readonly right: Expression }
  | { readonly op: 'in'; readonly item: Expression; readonly set: Expression }
  | { readonly op: 'intersects'; readonly list: Expression; readonly set: Expression }
  /** Every item of the list is in the set; an empty list is. */
  | { readonly op: 'within'; readonly list: Expression; readonly set: Expression }
  | { readonly op: 'all' | 'any'; readonly operands: readonly Expression[] }
  | { readonly op: 'not'; readonly operand: Expression }
  | { readonly op: 'add' | 'sub'; readonly left: Expression; readonly right: Expression }
  | { readonly op: 'mul'; readonly operand: Expression; readonly by: string }
  | { readonly op: 'min' | 'max'; readonly operands: readonly Expression[] }
  | { readonly op: 'convert'; readonly operand: Expression; readonly currency: string }
  | {
      readonly op: 'since';
      readonly date: Expression;
      readonly duration: string;
      readonly at?: string | undefined;
    }
  | {
      readonly op: 'count' | 'some' | 'every';
      readonly over: CollectionName;
      readonly where: Expression;
      readonly generations?: number | undefined;
    }
  | {
      readonly op: 'sum';
      readonly over: CollectionName;
      readonly value: Expression;
      readonly where?: Expression | undefined;
      readonly generations?: number | undefined;
    }
  /**
   * The time the periods of a record collection that meet `where` cover, in the `window` before the
   * date (`at`, or the date facts are read at; all time without a window), is at least `atLeast`:
   * in one unbroken stretch when `continuous`, else added up. A period runs from its start through
   * its end day; touching or overlapping periods join. Added-up time is counted in days against the
   * days `atLeast` spans back from the date.
   */
  | {
      readonly op: 'covers';
      readonly over: CollectionName;
      readonly where?: Expression | undefined;
      readonly atLeast: string;
      readonly window?: string | undefined;
      readonly continuous: boolean;
      readonly at?: string | undefined;
    };

const safeInteger = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const generations = z.number().int().min(1).max(maxAncestorGenerations).optional();

/** Every operator of {@link Expression}, so a screen can name each one. */
export const expressionOperators = [
  'bool',
  'unmodeled',
  'int',
  'decimal',
  'money',
  'date',
  'token',
  'tokens',
  'set',
  'fact',
  ...comparisonOperators,
  'in',
  'intersects',
  'within',
  'all',
  'any',
  'not',
  'add',
  'sub',
  'mul',
  'min',
  'max',
  'convert',
  'since',
  'count',
  'some',
  'every',
  'sum',
  'covers',
] as const satisfies readonly Expression['op'][];

export const expressionSchema: z.ZodType<Expression> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.strictObject({ op: z.literal('bool'), value: z.boolean() }),
    z.strictObject({ op: z.literal('unmodeled') }),
    z.strictObject({ op: z.literal('int'), value: safeInteger }),
    z.strictObject({ op: z.literal('decimal'), value: decimalSchema }),
    z.strictObject({ op: z.literal('money'), amount: safeInteger, currency: currencyCodeSchema }),
    z.strictObject({ op: z.literal('date'), value: calendarDateSchema }),
    z.strictObject({ op: z.literal('token'), value: tokenSchema }),
    z.strictObject({ op: z.literal('tokens'), values: z.array(tokenSchema).min(1).max(300) }),
    z.strictObject({ op: z.literal('set'), id: slugSchema }),
    z.strictObject({
      op: z.literal('fact'),
      key: factReferenceSchema,
      at: referenceDateNameSchema.optional(),
    }),
    ...comparisonOperators.map((op) =>
      z.strictObject({ op: z.literal(op), left: expressionSchema, right: expressionSchema }),
    ),
    z.strictObject({ op: z.literal('in'), item: expressionSchema, set: expressionSchema }),
    z.strictObject({ op: z.literal('intersects'), list: expressionSchema, set: expressionSchema }),
    z.strictObject({ op: z.literal('within'), list: expressionSchema, set: expressionSchema }),
    ...(['all', 'any'] as const).map((op) =>
      z.strictObject({ op: z.literal(op), operands: z.array(expressionSchema).min(1).max(50) }),
    ),
    z.strictObject({ op: z.literal('not'), operand: expressionSchema }),
    ...(['add', 'sub'] as const).map((op) =>
      z.strictObject({ op: z.literal(op), left: expressionSchema, right: expressionSchema }),
    ),
    z.strictObject({ op: z.literal('mul'), operand: expressionSchema, by: decimalSchema }),
    ...(['min', 'max'] as const).map((op) =>
      z.strictObject({ op: z.literal(op), operands: z.array(expressionSchema).min(2).max(10) }),
    ),
    z.strictObject({
      op: z.literal('convert'),
      operand: expressionSchema,
      currency: currencyCodeSchema,
    }),
    z.strictObject({
      op: z.literal('since'),
      date: expressionSchema,
      duration: durationSchema,
      at: referenceDateNameSchema.optional(),
    }),
    ...(['count', 'some', 'every'] as const).map((op) =>
      z.strictObject({
        op: z.literal(op),
        over: z.enum(collectionNames),
        where: expressionSchema,
        generations,
      }),
    ),
    z.strictObject({
      op: z.literal('sum'),
      over: z.enum(collectionNames),
      value: expressionSchema,
      where: expressionSchema.optional(),
      generations,
    }),
    z.strictObject({
      op: z.literal('covers'),
      over: z.enum(collectionNames),
      where: expressionSchema.optional(),
      atLeast: durationSchema,
      window: durationSchema.optional(),
      continuous: z.boolean(),
      at: referenceDateNameSchema.optional(),
    }),
  ]),
);

/** The direct children of an expression node. */
export function childrenOf(expression: Expression): readonly Expression[] {
  switch (expression.op) {
    case 'eq':
    case 'ne':
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
    case 'add':
    case 'sub':
      return [expression.left, expression.right];
    case 'in':
      return [expression.item, expression.set];
    case 'intersects':
    case 'within':
      return [expression.list, expression.set];
    case 'all':
    case 'any':
    case 'min':
    case 'max':
      return expression.operands;
    case 'not':
    case 'mul':
    case 'convert':
      return [expression.operand];
    case 'since':
      return [expression.date];
    case 'count':
    case 'some':
    case 'every':
      return [expression.where];
    case 'sum':
      return expression.where === undefined
        ? [expression.value]
        : [expression.value, expression.where];
    case 'covers':
      return expression.where === undefined ? [] : [expression.where];
    case 'bool':
    case 'unmodeled':
    case 'int':
    case 'decimal':
    case 'money':
    case 'date':
    case 'token':
    case 'tokens':
    case 'set':
    case 'fact':
      return [];
  }
}

export function nodeCount(expression: Expression): number {
  return 1 + childrenOf(expression).reduce((total, child) => total + nodeCount(child), 0);
}

export function depth(expression: Expression): number {
  return 1 + Math.max(0, ...childrenOf(expression).map(depth));
}

/**
 * Whether an expression can never be negative, so an unbounded sum of it is unbounded above only
 * (spec 0002, R4): no `sub`, no negative literal or multiplier, only non-negative facts.
 */
export function isNonNegative(expression: Expression): boolean {
  switch (expression.op) {
    case 'int':
      return expression.value >= 0;
    case 'decimal':
      return scaledDecimal(expression.value as Decimal).units >= 0n;
    case 'money':
      return expression.amount >= 0;
    case 'fact':
      return resolveFactReference(expression.key)?.definition.nonNegative === true;
    case 'mul':
      return (
        scaledDecimal(expression.by as Decimal).units >= 0n && isNonNegative(expression.operand)
      );
    case 'add':
    case 'min':
    case 'max':
    case 'convert':
      return childrenOf(expression).every(isNonNegative);
    case 'sum':
      return isNonNegative(expression.value);
    case 'count':
      return true;
    default:
      return false;
  }
}
