import type { DestinationComparison } from '@arca/api-contract/client';
import { StatusChip, cardClass } from '@arca/ui';
import { Link } from '@tanstack/react-router';
import { Fragment, useId, useState } from 'react';
import { FlagLead } from '../country-flag.js';
import { textLinkClass } from '../forms/text-link.js';
import { resultsAnchor } from '../results/group.js';
import { statusTones } from '../results/status-tone.js';
import { PlaceHeader, StarCell, TotalCell, stickyCell } from './cells.js';
import { ReadingLines, SuggestionLines } from './criterion-lines.js';
import type { Edit, Preferences } from './edits.js';
import { RegionRows } from './regions.js';
import { measured, type CompareWords, type ComparedCountry, type Criterion } from './words.js';

type Change = (edit: Edit) => void;

const weights = [0, 1, 2, 3, 4, 5] as const;

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
  const columns = criteria.length + 3;
  const row = (country: ComparedCountry) => (
    <CountryRow
      key={country.country}
      country={country}
      criteria={criteria}
      columns={columns}
      weightOf={weightOf}
      preferences={preferences}
      change={change}
      words={words}
    />
  );
  return (
    <div className={`${cardClass} relative overflow-x-auto`}>
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{t('compare.tableCaption')}</caption>
        <thead>
          <tr className="border-b border-line align-bottom">
            <th scope="col" className={`${stickyCell} min-w-48 p-3 font-medium`}>
              {t('compare.countryColumn')}
            </th>
            <th scope="col" className="p-3">
              <span className="sr-only">{t('compare.actionsColumn')}</span>
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
        <tbody>{ranked.map(row)}</tbody>
        {fewData.length > 0 && (
          <tbody>
            <tr className="border-b border-line bg-soft">
              <th scope="rowgroup" colSpan={columns} className="p-3 text-left font-normal">
                <span className="sticky left-3 flex max-w-prose flex-col">
                  <span className="font-medium">{t('compare.fewDataTitle')}</span>
                  <span className="text-small text-muted">{t('compare.fewDataLead')}</span>
                </span>
              </th>
            </tr>
            {fewData.map(row)}
          </tbody>
        )}
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
  columns,
  weightOf,
  preferences,
  change,
  words,
}: {
  readonly country: ComparedCountry;
  readonly criteria: DestinationComparison['criteria'];
  readonly columns: number;
  readonly weightOf: (criterion: Criterion) => number;
  readonly preferences: Preferences;
  readonly change: Change;
  readonly words: CompareWords;
}) {
  const { t } = words;
  const [open, setOpen] = useState(false);
  const [regionsOpen, setRegionsOpen] = useState(false);
  const detailsId = useId();
  const regionsId = useId();
  const name = words.country(country.country);
  const scores = new Map(country.scores.map((score) => [score.criterion, score]));
  const read = criteria.filter((criterion) => {
    const score = scores.get(criterion.id);
    return score?.reading !== undefined || score?.suggested !== undefined;
  });
  return (
    <Fragment>
      <tr className="border-b border-line align-top">
        <PlaceHeader
          rank={country.rank}
          rankLabel={t('compare.place', { rank: String(country.rank) })}
        >
          <FlagLead code={country.country} />
          {name}
        </PlaceHeader>
        <td className="p-3">
          <span className="flex flex-col items-start gap-1">
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
            {country.regions.length > 0 && (
              <button
                type="button"
                className={`${textLinkClass} text-small whitespace-nowrap`}
                aria-expanded={regionsOpen}
                aria-label={
                  regionsOpen
                    ? t('compare.regions.hideLabel', { country: name })
                    : t('compare.regions.showLabel', { country: name, n: country.regions.length })
                }
                {...(regionsOpen ? { 'aria-controls': regionsId } : {})}
                onClick={() => {
                  setRegionsOpen(!regionsOpen);
                }}
              >
                {regionsOpen
                  ? t('compare.regions.hide')
                  : t('compare.regions.show', { n: country.regions.length })}
              </button>
            )}
          </span>
        </td>
        <TotalCell total={country.total} coverage={country.coverage} words={words} />
        {criteria.map((criterion) => {
          const score = scores.get(criterion.id);
          return (
            <td
              key={criterion.id}
              className={`p-3 ${weightOf(criterion) === 0 ? 'opacity-60' : ''}`}
            >
              {measured(criterion) ? (
                <span
                  className={`tabular-nums ${score?.score == null ? 'text-small text-muted' : ''}`}
                >
                  {score?.score == null ? t('compare.noData') : words.decimal(score.score)}
                </span>
              ) : (
                <StarCell
                  criterion={criterion}
                  place={country.country}
                  placeName={name}
                  rating={preferences.ratings[criterion.id]?.[country.country]}
                  suggested={score?.suggested?.stars}
                  change={change}
                  words={words}
                />
              )}
            </td>
          );
        })}
      </tr>
      {open && (
        <tr id={detailsId} className="border-b border-line bg-soft">
          <td colSpan={columns} className="p-3">
            <ul className="sticky left-3 grid max-w-5xl gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {read.map((criterion) => {
                const { reading, suggested } = scores.get(criterion.id) ?? {};
                const label = words.label(criterion);
                return (
                  <li key={criterion.id} className="flex flex-col gap-1">
                    <span className="font-medium">{label}</span>
                    {reading !== undefined && (
                      <ReadingLines criterion={criterion} reading={reading} words={words} />
                    )}
                    {reading === undefined && suggested !== undefined && (
                      <SuggestionLines
                        suggested={suggested}
                        rated={preferences.ratings[criterion.id]?.[country.country] !== undefined}
                        confirmLabel={t('compare.suggested.confirmFor', {
                          criterion: label,
                          country: name,
                        })}
                        onConfirm={(stars) => {
                          change({
                            kind: 'rating',
                            criterion: criterion.id,
                            country: country.country,
                            rating: stars,
                          });
                        }}
                        words={words}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </td>
        </tr>
      )}
      {regionsOpen && (
        <RegionRows
          id={regionsId}
          country={country}
          criteria={criteria}
          columns={columns}
          weightOf={weightOf}
          preferences={preferences}
          change={change}
          words={words}
        />
      )}
    </Fragment>
  );
}
