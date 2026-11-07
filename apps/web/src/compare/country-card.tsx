import { staleAfterDays, type DestinationComparison } from '@arca/api-contract/client';
import { Bar, StarRating, StatusChip, cardClass, formatCalendarDate } from '@arca/ui';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import { textLinkClass } from '../forms/text-link.js';
import { resultsAnchor } from '../results/group.js';
import { statusTones } from '../results/status-tone.js';
import type { Edit, Preferences } from './edits.js';
import { measured, type CompareWords, type Criterion, type Reading } from './words.js';

type ComparedCountry = DestinationComparison['countries'][number];

/**
 * One country of the comparison: its place, total and coverage as the API computed them, the
 * person's best route status there, and each criterion's score with what it comes from.
 */
export function CountryCard({
  country,
  row,
  criteria,
  preferences,
  change,
  words,
}: {
  readonly country: ComparedCountry;
  /** Its place in the list, counted from 0, for the bar's staggered growth. */
  readonly row: number;
  readonly criteria: DestinationComparison['criteria'];
  readonly preferences: Preferences;
  readonly change: (edit: Edit) => void;
  readonly words: CompareWords;
}) {
  const { t } = words;
  const nameId = useId();
  const name = words.country(country.country);
  const scores = new Map(country.scores.map((score) => [score.criterion, score]));
  // The weights the person just chose decide what is listed; the scores catch up with the API.
  const weightOf = (criterion: Criterion) => preferences.weights[criterion.id] ?? criterion.weight;
  const counted = criteria.filter((criterion) => weightOf(criterion) > 0);
  const total = country.total === null ? null : words.decimal(country.total);
  return (
    <li>
      <article aria-labelledby={nameId} className={`${cardClass} flex flex-col gap-2 p-4 sm:p-5`}>
        <div className="flex items-baseline gap-3">
          {country.rank !== null && (
            <span
              aria-hidden="true"
              className={`font-display text-title tabular-nums ${country.rank === 1 ? 'text-primary' : 'text-muted'}`}
            >
              {country.rank}
            </span>
          )}
          <h4 id={nameId} className="min-w-0 flex-1 font-display text-title break-words">
            {country.rank !== null && (
              <span className="sr-only">{t('compare.place', { rank: String(country.rank) })} </span>
            )}
            {name}
          </h4>
          {total === null ? (
            <span className="text-small text-muted">{t('compare.noTotal')}</span>
          ) : (
            <span className="shrink-0 font-display text-title tabular-nums">
              <span aria-hidden="true">
                {total}
                <span className="ml-1 font-sans text-small text-muted">{t('compare.outOf')}</span>
              </span>
              <span className="sr-only">{t('compare.totalLabel', { total })}</span>
            </span>
          )}
        </div>
        {country.total !== null && (
          <Bar ratio={Number(country.total) / 10} lead={country.rank === 1} row={row} />
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {country.routeStatus !== null && (
            <StatusChip
              tone={statusTones[country.routeStatus]}
              label={t('results.status', { status: country.routeStatus })}
            />
          )}
          <span className="text-small text-muted">
            {t('compare.coverage', { coverage: String(country.coverage) })}
          </span>
          <div className="flex flex-wrap items-center gap-x-6 sm:ml-auto">
            <Link
              to="/family/results"
              hash={resultsAnchor(country.country)}
              className={textLinkClass}
            >
              {t('compare.routes')}
            </Link>
            <button
              type="button"
              className={textLinkClass}
              aria-label={t('compare.hideLabel', { country: name })}
              onClick={() => {
                change({ kind: 'hide', country: country.country });
              }}
            >
              {t('compare.hide')}
            </button>
          </div>
        </div>
        <details>
          <summary className={`${textLinkClass} cursor-pointer`}>{t('compare.details')}</summary>
          <ul className="mt-2 flex flex-col divide-y divide-line">
            {counted.map((criterion) => (
              <CriterionLine
                key={criterion.id}
                criterion={criterion}
                weight={weightOf(criterion)}
                score={scores.get(criterion.id)}
                rating={preferences.ratings[criterion.id]?.[country.country]}
                country={country.country}
                countryName={name}
                change={change}
                words={words}
              />
            ))}
          </ul>
          {counted.length < criteria.length && (
            <p className="mt-2 text-small text-muted">{t('compare.zeroLeftOut')}</p>
          )}
        </details>
      </article>
    </li>
  );
}

function CriterionLine({
  criterion,
  weight,
  score,
  rating,
  country,
  countryName,
  change,
  words,
}: {
  readonly criterion: Criterion;
  readonly weight: number;
  readonly score: ComparedCountry['scores'][number] | undefined;
  /** The person's stars as they just chose them. */
  readonly rating: number | undefined;
  readonly country: string;
  readonly countryName: string;
  readonly change: (edit: Edit) => void;
  readonly words: CompareWords;
}) {
  const { t } = words;
  const label = words.label(criterion);
  const objective = measured(criterion);
  const value =
    score?.score == null
      ? t(objective ? 'compare.noData' : 'compare.notRated')
      : words.decimal(score.score);
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 break-words">
          <span className="font-medium">{label}</span>{' '}
          <span className="text-small text-muted">
            {t('compare.weightOf', { weight: String(weight) })}
          </span>
        </p>
        <span
          className={`shrink-0 tabular-nums ${score?.score == null ? 'text-small text-muted' : 'font-medium'}`}
        >
          {value}
        </span>
      </div>
      {score?.reading !== undefined && (
        <ReadingLines criterion={criterion} reading={score.reading} words={words} />
      )}
      {!objective && (
        <StarRating
          legend={t('compare.ratingFor', { criterion: label, country: countryName })}
          caption={t('compare.rating')}
          value={rating}
          onChange={(stars) => {
            change({ kind: 'rating', criterion: criterion.id, country, rating: stars });
          }}
          onClear={() => {
            change({ kind: 'rating', criterion: criterion.id, country, rating: undefined });
          }}
          starLabel={(n) => t('compare.star', { n })}
          clearLabel={t('compare.clearStars')}
        />
      )}
    </li>
  );
}

/** What an objective score comes from: the value and its year, then its source as plain text. */
function ReadingLines({
  criterion,
  reading,
  words,
}: {
  readonly criterion: Criterion;
  readonly reading: Reading;
  readonly words: CompareWords;
}) {
  const { t } = words;
  return (
    <>
      <p className="text-small">{words.reading(criterion, reading)}</p>
      <p className="text-caption break-all text-muted">
        {t('compare.source', {
          url: reading.source.url,
          date: formatCalendarDate(reading.source.verifiedAt, words.language),
        })}
      </p>
      {reading.stale && (
        <p className="text-caption text-warn-ink">
          {t('compare.stale', { days: String(staleAfterDays) })}
        </p>
      )}
    </>
  );
}
