/**
 * The only values a workflow run may receive (ADR-0009): identifiers and dates, so no personal data
 * reaches a run's stored input. Kept apart from the SDK so the Hono app can build them without it.
 */
declare const brand: unique symbol;
type Branded<T, Name extends string> = T & { readonly [brand]: Name };

/** A record's UUID. Workflow arguments carry identifiers only (ADR-0009). */
export type EntityId = Branded<string, 'EntityId'>;
/** A calendar date, `YYYY-MM-DD`, in UTC. */
export type IsoDate = Branded<string, 'IsoDate'>;
export type WorkflowArgument = EntityId | IsoDate;

export class InvalidWorkflowArgumentError extends Error {
  override name = 'InvalidWorkflowArgumentError';
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function entityId(value: string): EntityId {
  if (!uuidPattern.test(value)) throw new InvalidWorkflowArgumentError('not a UUID');
  return value as EntityId;
}

export function utcDate(at: Date): IsoDate {
  return at.toISOString().slice(0, 10) as IsoDate;
}
