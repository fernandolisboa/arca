import type { VersionView } from '@arca/domain';

/*
 * A version as the AI features read it, shared by the rule summary (ADR-0025) and the independent
 * check (ADR-0027). Reports and summaries are keyed by the version's hash, not by this text, so a
 * change to the layout bumps both features' prompt versions.
 */

/**
 * What the model reads: the version's content alone, field by field. Its hash, its state and what
 * rejecting it would do to today's selection stay out; a field added to the view stays out until
 * it is listed here.
 */
const summaryFields = [
  'routeId',
  'number',
  'title',
  'country',
  'tags',
  'effectiveFrom',
  'corrects',
  'status',
  'currency',
  'leapDayBirthday',
  'leapDayBirthdaySources',
  'referenceDates',
  'closureSources',
  'pins',
  'requirements',
  'assessments',
  'dependents',
  'costs',
  'durations',
  'countrySets',
  'sources',
  'replaces',
  'cases',
] as const satisfies readonly Exclude<keyof VersionView, 'hash' | 'state' | 'rejection'>[];

const contentOf = (view: VersionView, fields: readonly (keyof VersionView)[]) =>
  JSON.stringify(Object.fromEntries(fields.map((field) => [field, view[field]])));

export function summaryContent(view: VersionView): string {
  return contentOf(view, summaryFields);
}

/**
 * What the independent check's model reads of a version (ADR-0027): the summary's fields without
 * the rule cases, which are tests of the rule rather than what the law says.
 */
export function checkContent(view: VersionView): string {
  return contentOf(
    view,
    summaryFields.filter((field) => field !== 'cases'),
  );
}
