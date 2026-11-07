import { z } from 'zod';
import { leapDayBirthdaySchema } from '../calendar/age.js';
import { calendarDateSchema } from '../calendar/calendar-date.js';
import { durationSchema } from '../calendar/duration.js';
import { currencyCodeSchema } from '../money/currency.js';
import { relationshipSteps } from '../case/paths.js';
import { countryCodeSchema } from '../case/snapshot.js';
import {
  expressionSchema,
  factReferenceSchema,
  referenceDateNameSchema,
  slugSchema,
} from './expression.js';

/** A title or name in knowledge data: plain text, rendered escaped (spec 0002, R4). */
export const knowledgeTextSchema = z.string().min(1).max(200);
/** A version or pin number: contiguous from 1. */
export const versionNumberSchema = z.number().int().min(1);

const text = knowledgeTextSchema;
const sourceIds = z.array(slugSchema).min(1).max(20);

/** A reference to an exact version of another knowledge file. */
export const pinSchema = z.strictObject({ id: slugSchema, number: versionNumberSchema });

export const sourceSchema = z.strictObject({
  id: slugSchema,
  url: z.string().max(2000).startsWith('https://'),
  title: text,
  kind: z.enum(['official', 'secondary']),
  verifiedAt: calendarDateSchema,
});

export const requirementSchema = z.strictObject({
  id: slugSchema,
  title: text,
  expression: expressionSchema,
  sources: sourceIds,
});

/** A judgment factor, shown with its evidence and never as pass or fail (ADR-0002). */
export const assessmentSchema = z.strictObject({
  id: slugSchema,
  title: text,
  /** Facts that support the factor, read on the principal or the unit. */
  evidence: z.array(factReferenceSchema).min(1).max(20),
  sources: sourceIds,
});

/** Who a route covers: a relationship path from the principal plus a condition on the candidate. */
export const dependentRuleSchema = z.strictObject({
  id: slugSchema,
  title: text,
  path: z.array(z.enum(relationshipSteps)).min(1).max(3),
  condition: expressionSchema,
  /** Edges are crossed and facts read at this named reference date instead of `factsAsOf`. */
  at: referenceDateNameSchema.optional(),
  sources: sourceIds,
});

export const costSchema = z.strictObject({
  id: slugSchema,
  title: text,
  /** A free tag such as `fee` or `proof_of_means`; never an enumeration in code. */
  kind: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  amount: expressionSchema,
  appliesTo: z.enum(['principal', 'each_dependent', 'unit']),
  condition: expressionSchema.optional(),
  sources: sourceIds,
});

export const durationStageSchema = z.strictObject({
  id: slugSchema,
  title: text,
  min: durationSchema,
  max: durationSchema,
  sources: sourceIds,
});

export const routeIdSchema = z.string().regex(/^[a-z]{2}-[a-z0-9][a-z0-9-]{0,62}$/);

/**
 * One immutable version of a route (spec 0002, R4). Country and tags are fields of every version,
 * so they are hashed and activated with it. A closed version carries no rules, only the official
 * sources of its closure.
 */
export const routeVersionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    routeId: routeIdSchema,
    number: versionNumberSchema,
    title: text,
    /** A current country: ISO 3166-1 alpha-2. */
    country: z.string().regex(/^[A-Z]{2}$/),
    tags: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,39}$/)).max(20),
    effectiveFrom: calendarDateSchema,
    corrects: versionNumberSchema.optional(),
    status: z.enum(['open', 'closed']),
    currency: currencyCodeSchema,
    leapDayBirthday: leapDayBirthdaySchema.optional(),
    leapDayBirthdaySources: sourceIds.optional(),
    /** Named dates the context supplies, such as `filingDate`; rules may read facts at them. */
    referenceDates: z.array(referenceDateNameSchema).max(10).optional(),
    sources: z.array(sourceSchema).min(1).max(50),
    closureSources: sourceIds.optional(),
    countries: pinSchema,
    formerCountries: pinSchema,
    countrySets: z.array(pinSchema).max(20),
    officialDomains: z.array(pinSchema).min(1).max(10),
    requirements: z.array(requirementSchema).max(50),
    assessments: z.array(assessmentSchema).max(20),
    dependents: z.array(dependentRuleSchema).max(20),
    costs: z.array(costSchema).max(50),
    durations: z.array(durationStageSchema).max(20),
  })
  .refine((version) => version.corrects === undefined || version.corrects < version.number, {
    message: 'A correction names a lower version number',
  });

export type RouteVersion = z.infer<typeof routeVersionSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export type Assessment = z.infer<typeof assessmentSchema>;
export type DependentRule = z.infer<typeof dependentRuleSchema>;
export type Cost = z.infer<typeof costSchema>;
export type DurationStage = z.infer<typeof durationStageSchema>;
export type Pin = z.infer<typeof pinSchema>;

/** A versioned country set, such as treaty countries, with the files it pins. */
export const countrySetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: slugSchema,
  number: versionNumberSchema,
  title: text,
  members: z.array(countryCodeSchema).min(1).max(300),
  sources: z.array(sourceSchema).min(1).max(20),
  countries: pinSchema,
  formerCountries: pinSchema,
  officialDomains: z.array(pinSchema).min(1).max(10),
});

export type CountrySet = z.infer<typeof countrySetSchema>;

/** Hosts that count as official for a country or an international body, each with its source. */
export const officialDomainListSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: slugSchema,
  number: versionNumberSchema,
  issuer: text,
  hosts: z
    .array(
      z.strictObject({
        host: z
          .string()
          .max(253)
          .regex(
            /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/,
          ),
        source: sourceSchema,
      }),
    )
    .min(1)
    .max(100),
});

export type OfficialDomainList = z.infer<typeof officialDomainListSchema>;

/** JSON Schema of a route version for editors. */
export function routeVersionJsonSchema(): unknown {
  return z.toJSONSchema(routeVersionSchema, { io: 'input', unrepresentable: 'any' });
}

/**
 * Whether parsed JSON nests no deeper than `max`, checked without recursion so a hostile file
 * cannot overflow the stack before the schema's own limits apply.
 */
export function jsonDepthWithin(value: unknown, max: number): boolean {
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 0 }];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    if (next.depth > max) return false;
    if (typeof next.node === 'object' && next.node !== null) {
      for (const child of Object.values(next.node))
        stack.push({ node: child, depth: next.depth + 1 });
    }
  }
  return true;
}

/** Deep enough for a 16-level expression (two JSON levels each) inside a version file. */
export const maxKnowledgeJsonDepth = 48;
