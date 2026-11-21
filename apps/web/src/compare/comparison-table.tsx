import type { DestinationComparison } from '@arca/api-contract/client';
import { StarRating, StatusChip, cardClass } from '@arca/ui';
import { Link } from '@tanstack/react-router';
import { Fragment, useId, useState } from 'react';
import { FlagLead } from '../country-flag.js';
import { textLinkClass } from '../forms/text-link.js';
import { resultsAnchor } from '../results/group.js';
import { statusTones } from '../results/status-tone.js';
import { ReadingLines } from './country-card.js';
import type { Edit, Preferences } from './edits.js';
import { measured, type CompareWords, type Criterion } from './words.js';

type ComparedCountry = DestinationComparison['countries'][number];
type Change = (edit: Edit) => void;

const weights = [0, 1, 2, 3, 4, 5] as const;
const stickyCell = 'sticky left-0 z-10 bg-surface';

/**
 * The comparison on a wide screen: a country per row, a criterion per column with its weight on
 * top, so a weight sits beside the scores it changes. Ranked countries first, then "Poucos dados".
 */
export function ComparisonTable({
  ranked,
  fewData,
  criteria,
  preferences,
  change,
  words,
}: {
  readonly ranked: readonly ComparedCountry[];
  readonly fewData: readonly ComparedCountry[];
  readonly criteria: DestinationComparison['criteria'];
  readonly preferences: Preferences;
  readonly change: Change;
  readonly words: CompareWords;
}) {
  const { t } = words;
  const weightOf = (criterion: Criterion) => preferences.weights[criterion.id] ?? criterion.weight;
  const columns = criteria.length + 2;
  const row = (country: ComparedCountry) => (
    <CountryRow
      key={country.country}
      country={country}
      criteria={criteria}
      weightOf={weightOf}
      preferences={preferences}
      change={change}
      words={words}
    />
  );
  return (
    <div className={`${cardClass} overflow-x-auto`}>
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{t('compare.tableCaption')}</caption>
        <thead>
          <tr className="border-b border-line align-bottom">
            <th scope="col" className={`${stickyCell} min-w-72 p-3 font-medium`}>
              {t('compare.countryColumn')}
            </th>
            <th scope="col" className="p-3 font-medium whitespace-nowrap">
              {t('compare.totalColumn')}
            </th>
            {criteria.map((criterion) => (
              <WeightHeader
                key={criterion.id}
                criterion={criterion}
                weight={weightOf(criterion)}
                change={change}
                words={words}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {ranked.map(row)}
          {fewData.length > 0 && (
            <tr className="border-b border-line bg-soft">
              <th scope="colgroup" colSpan={columns} className="p-3 text-left font-normal">
                <span className="sticky left-3 flex max-w-prose flex-col">
                  <span className="font-medium">{t('compare.fewDataTitle')}</span>
                  <span className="text-small text-muted">{t('compare.fewDataLead')}</span>
                </span>
              </th>
            </tr>
          )}
          {fewData.map(row)}
        </tbody>
      </table>
    </div>
  );
}

function WeightHeader({
  criterion,
  weight,
  change,
  words,
}: {
  readonly criterion: Criterion;
  readonly weight: number;
  readonly change: Change;
  readonly words: CompareWords;
}) {
  const { t } = words;
  const selectId = useId();
  const label = words.label(criterion);
  return (
    <th scope="col" className={`min-w-32 p-3 font-normal ${weight === 0 ? 'text-muted' : ''}`}>
      <span className="flex flex-col gap-1">
        <span className="font-medium break-words">{label}</span>
        <span className="text-caption text-muted">
          {t(measured(criterion) ? 'compare.fromData' : 'compare.fromStars')}
        </span>
        <span className="flex items-center gap-2">
          <label htmlFor={selectId} className="text-small text-muted">
            {t('compare.weight')}
            <span className="sr-only"> {label}</span>
          </label>
          <select
            id={selectId}
            value={weight}
            onChange={(event) => {
              change({
                kind: 'weight',
                criterion: criterion.id,
                weight: Number(event.target.value),
              });
            }}
            className="min-h-9 rounded-control border border-line bg-surface px-2 text-body text-ink tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {weights.map((each) => (
              <option key={each} value={each}>
                {each}
              </option>
            ))}
          </select>
        </span>
      </span>
    </th>
  );
}

function CountryRow({
  country,
  criteria,
  weightOf,
  preferences,
  change,
  words,
}: {
  readonly country: ComparedCountry;
  readonly criteria: DestinationComparison['criteria'];
  readonly weightOf: (criterion: Criterion) => number;
  readonly preferences: Preferences;
  readonly change: Change;
  readonly words: CompareWords;
}) {
  const { t } = words;
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const name = words.country(country.country);
  const scores = new Map(country.scores.map((score) => [score.criterion, score]));
  const read = criteria.filter((criterion) => scores.get(criterion.id)?.reading !== undefined);
  const total = country.total === null ? null : words.decimal(country.total);
  return (
    <Fragment>
      <tr className="border-b border-line align-top">
        <th scope="row" className={`${stickyCell} p-3 text-left font-normal`}>
          <span className="flex flex-col gap-1">
            <span className="flex items-baseline gap-2 font-medium">
              {country.rank !== null && (
                // The number is drawn by CSS, so the row's name reads "1º lugar Portugal" once.
                <span
                  aria-hidden="true"
                  data-rank={country.rank}
                  className={`tabular-nums before:content-[attr(data-rank)] ${country.rank === 1 ? 'text-primary' : 'text-muted'}`}
                />
              )}
              <span>
                {country.rank !== null && (
                  <span className="sr-only">
                    {t('compare.place', { rank: String(country.rank) })}{' '}
                  </span>
                )}
                <FlagLead code={country.country} />
                {name}
              </span>
            </span>
            {country.routeStatus !== null && (
              <StatusChip
                tone={statusTones[country.routeStatus]}
                label={t('results.status', { status: country.routeStatus })}
              />
            )}
            <span className="flex gap-x-3 text-small whitespace-nowrap">
              {read.length > 0 && (
                <button
                  type="button"
                  className={textLinkClass}
                  aria-expanded={open}
                  {...(open ? { 'aria-controls': detailsId } : {})}
                  onClick={() => {
                    setOpen(!open);
                  }}
                >
                  {t('compare.sources')}
                </button>
              )}
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
            </span>
          </span>
        </th>
        <td className="p-3 whitespace-nowrap">
          {total === null ? (
            <span className="text-small text-muted">{t('compare.noTotal')}</span>
          ) : (
            <span className="flex flex-col">
              <span className="font-display text-lead tabular-nums">
                <span aria-hidden="true">{total}</span>
                <span className="sr-only">{t('compare.totalLabel', { total })}</span>
              </span>
              <span className="text-caption text-muted">
                {t('compare.coverage', { coverage: String(country.coverage) })}
              </span>
            </span>
          )}
        </td>
        {criteria.map((criterion) => {
          const score = scores.get(criterion.id);
          const objective = measured(criterion);
          const label = words.label(criterion);
          return (
            <td
              key={criterion.id}
              className={`p-3 ${weightOf(criterion) === 0 ? 'opacity-60' : ''}`}
            >
              {objective ? (
                <span
                  className={`tabular-nums ${score?.score == null ? 'text-small text-muted' : ''}`}
                >
                  {score?.score == null ? t('compare.noData') : words.decimal(score.score)}
                </span>
              ) : (
                <StarRating
                  compact
                  legend={t('compare.ratingFor', { criterion: label, country: name })}
                  caption={t('compare.rating')}
                  value={preferences.ratings[criterion.id]?.[country.country]}
                  onChange={(stars) => {
                    change({
                      kind: 'rating',
                      criterion: criterion.id,
                      country: country.country,
                      rating: stars,
                    });
                  }}
                  onClear={() => {
                    change({
                      kind: 'rating',
                      criterion: criterion.id,
                      country: country.country,
                      rating: undefined,
                    });
                  }}
                  starLabel={(n) => t('compare.star', { n })}
                  clearLabel={t('compare.clearStarsFor', { criterion: label, country: name })}
                />
              )}
            </td>
          );
        })}
      </tr>
      {open && (
        <tr id={detailsId} className="border-b border-line bg-soft">
          <td colSpan={criteria.length + 2} className="p-3">
            <ul className="sticky left-3 grid max-w-5xl gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {read.map((criterion) => {
                const reading = scores.get(criterion.id)?.reading;
                return (
                  reading !== undefined && (
                    <li key={criterion.id} className="flex flex-col gap-1">
                      <span className="font-medium">{words.label(criterion)}</span>
                      <ReadingLines criterion={criterion} reading={reading} words={words} />
                    </li>
                  )
                );
              })}
            </ul>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
