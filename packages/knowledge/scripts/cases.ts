import {
  type MissingFact,
  type Relationship,
  calendarDateSchema,
  caseSnapshotSchema,
  fxTableSchema,
  opaqueIdSchema,
  referenceDateNameSchema,
  slugSchema,
} from '@arca/domain';
import { z } from 'zod';
import { sha256Schema } from '../src/entries.ts';

const statuses = [
  'unavailable',
  'not_eligible',
  'missing_information',
  'needs_assessment',
  'eligible',
] as const;

const people = z.array(opaqueIdSchema).max(60);

/**
 * One table-driven case for a route version (spec 0002, R8): a snapshot, inline or a synthetic
 * family pinned by number and hash, the principal, the context dates and rates, and the expected
 * result. Missing facts are written as `describeMissingFact` prints them, so a reviewer reads them.
 */
export const ruleCaseSchema = z
  .strictObject({
    id: slugSchema,
    /** A case this one replaces, after a change to the domain code changed its result (R6). */
    supersedes: slugSchema.optional(),
    reason: z.string().regex(/\S/).max(500).optional(),
    family: z
      .strictObject({ id: slugSchema, number: z.number().int().min(1), sha256: sha256Schema })
      .optional(),
    snapshot: caseSnapshotSchema.optional(),
    principal: opaqueIdSchema,
    rulesAsOf: calendarDateSchema,
    factsAsOf: calendarDateSchema.optional(),
    referenceDates: z.record(referenceDateNameSchema, calendarDateSchema).optional(),
    fx: fxTableSchema.optional(),
    expected: z.strictObject({
      status: z.enum(statuses),
      dependents: people,
      possibleDependents: people,
      missingFacts: z.array(z.string().min(1).max(300)).max(100),
    }),
  })
  .refine((entry) => (entry.family === undefined) !== (entry.snapshot === undefined), {
    message: 'A case has either a family or an inline snapshot',
  })
  .refine((entry) => (entry.supersedes === undefined) === (entry.reason === undefined), {
    message: 'A superseding case gives its reason',
  });

export const casesFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  cases: z.array(ruleCaseSchema).min(1).max(500),
});

export type RuleCase = z.infer<typeof ruleCaseSchema>;
export type CasesFile = z.infer<typeof casesFileSchema>;

/**
 * A missing fact as a cases file writes it, and as reviewers read it: `<fact>@<person>`, with
 * ` edge <edge>` or ` line <ancestor>>…>principal` when read across one; `relationship <edge>`;
 * `marker <marker>@<person>`. Cases files only gain entries, so this format never changes.
 */
export function describeMissingFact(fact: MissingFact): string {
  switch (fact.kind) {
    case 'fact': {
      const via = [
        ...(fact.edge === undefined ? [] : [`edge ${describeEdge(fact.edge)}`]),
        ...(fact.line === undefined ? [] : [`line ${fact.line.join('>')}`]),
      ];
      return [`${fact.reference}@${fact.personId}`, ...via].join(' ');
    }
    case 'relationship':
      return `relationship ${describeEdge(fact.edge)}`;
    case 'marker':
      return `marker ${fact.marker}@${fact.personId}`;
  }
}

/** `parent:<parent>><child>`, or `<spouse|partner>:<a>:<b>:<start>:<end>` with the people sorted. */
function describeEdge(edge: Relationship): string {
  if (edge.kind === 'parent') return `parent:${edge.parent}>${edge.child}`;
  const [a, b] = [...edge.people].sort();
  return [edge.kind, a, b, edge.start ?? '', edge.end ?? ''].join(':');
}
