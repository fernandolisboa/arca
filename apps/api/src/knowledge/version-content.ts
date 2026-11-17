import type { VersionView } from '@arca/domain';

/*
 * A version as the rule summary reads it (ADR-0025). Summaries are keyed by the version's hash, not
 * by this text, so a change to the layout bumps the summary's prompt version.
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

/**
 * A source field by field. Its machine-readable address stays out, so the layout stays as the
 * prompt's version describes it.
 */
const sourcesRead = (view: VersionView) =>
  view.sources.map(({ id, url, title, kind, verifiedAt, host, newHost }) => ({
    id,
    url,
    title,
    kind,
    verifiedAt,
    host,
    newHost,
  }));

const contentOf = (view: VersionView, fields: readonly (keyof VersionView)[]) =>
  JSON.stringify(
    Object.fromEntries(
      fields.map((field) => [field, field === 'sources' ? sourcesRead(view) : view[field]]),
    ),
  );

export function summaryContent(view: VersionView): string {
  return contentOf(view, summaryFields);
}
