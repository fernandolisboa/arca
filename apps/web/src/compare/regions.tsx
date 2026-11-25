import { cardClass } from '@arca/ui';
import { Fragment, useId, useState } from 'react';
import { textLinkClass } from '../forms/text-link.js';
import { PlaceHeader, StarCell, TotalCell } from './cells.js';
import { CriterionLine, SuggestionLines } from './criterion-lines.js';
import { type Edit, type Preferences, ratingEdit } from './edits.js';
import {
  measured,
  type CompareWords,
  type ComparedCountry,
  type ComparedRegion,
  type Criterion,
  type CriterionScore,
} from './words.js';

type Change = (edit: Edit) => void;

interface RegionProps {
  readonly country: ComparedCountry;
  readonly criteria: readonly Criterion[];
  readonly weightOf: (criterion: Criterion) => number;
  readonly preferences: Preferences;
  readonly change: Change;
  readonly words: CompareWords;
}

function scoresOf(region: ComparedRegion): ReadonlyMap<string, CriterionScore> {
  return new Map(region.scores.map((score) => [score.criterion, score]));
}

/**
 * A country's regions on a wide screen, as rows under the country's: ranked with the same weights,
 * each region's data where there is some and the country's, in grey, where there is none.
 */
export function RegionRows({
  id,
  columns,
  ...props
}: RegionProps & { readonly id: string; readonly columns: number }) {
  const { country, words } = props;
  const { t } = words;
  const name = words.country(country.country);
  return (
    <>
      <tr id={id} className="border-b border-line bg-soft">
        <th scope="rowgroup" colSpan={columns} className="p-3 text-left font-normal">
          <span className="sticky left-3 flex max-w-prose flex-col">
            <span className="font-medium">{t('compare.regions.title', { country: name })}</span>
            <span className="text-small text-muted">{t('compare.regions.lead')}</span>
          </span>
        </th>
      </tr>
      {country.regions.map((region) => (
        <RegionRow key={region.region} region={region} columns={columns} {...props} />
      ))}
    </>
  );
}

function RegionRow({
  region,
  columns,
  country,
  criteria,
  weightOf,
  preferences,
  change,
  words,
}: RegionProps & { readonly region: ComparedRegion; readonly columns: number }) {
  const { t } = words;
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const name = words.region(region.region);
  const countryName = words.country(country.country);
  const scores = scoresOf(region);
  const read = criteria.filter((criterion) => scores.get(criterion.id)?.suggested !== undefined);
  return (
    <Fragment>
      <tr className="border-b border-line align-top">
        <PlaceHeader
          rank={region.rank}
          rankLabel={t('compare.regions.place', {
            rank: String(region.rank),
            country: countryName,
          })}
          className="pl-8 font-normal"
        >
          {name}
        </PlaceHeader>
        <td className="p-3">
          {read.length > 0 && (
            <button
              type="button"
              className={`${textLinkClass} text-small whitespace-nowrap`}
              aria-label={t('compare.regions.sourcesLabel', { region: name })}
              aria-expanded={open}
              {...(open ? { 'aria-controls': detailsId } : {})}
              onClick={() => {
                setOpen(!open);
              }}
            >
              {t('compare.sources')}
            </button>
          )}
        </td>
        <TotalCell total={region.total} coverage={region.coverage} words={words} />
        {criteria.map((criterion) => {
          const score = scores.get(criterion.id);
          const inherited = score?.inherited === true;
          return (
            <td
              key={criterion.id}
              className={`p-3 ${weightOf(criterion) === 0 ? 'opacity-60' : ''}`}
            >
              {measured(criterion) ? (
                <span className="text-small text-muted tabular-nums">
                  {score?.score == null ? (
                    t('compare.noData')
                  ) : (
                    <>
                      {words.decimal(score.score)}
                      {inherited && (
                        <span className="sr-only"> {t('compare.regions.likeCountry')}</span>
                      )}
                    </>
                  )}
                </span>
              ) : (
                <StarCell
                  criterion={criterion}
                  place={region.region}
                  placeName={name}
                  rating={preferences.ratings[criterion.id]?.[region.region]}
                  suggested={score?.suggested?.stars ?? score?.countryStars}
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
                const suggested = scores.get(criterion.id)?.suggested;
                if (suggested === undefined) return null;
                const label = words.label(criterion);
                return (
                  <li key={criterion.id} className="flex flex-col gap-1">
                    <span className="font-medium">{label}</span>
                    <SuggestionLines
                      suggested={suggested}
                      regional
                      rated={preferences.ratings[criterion.id]?.[region.region] !== undefined}
                      confirmLabel={t('compare.suggested.confirmFor', {
                        criterion: label,
                        country: name,
                      })}
                      onConfirm={(stars) => {
                        change(ratingEdit(criterion.id, region.region, stars));
                      }}
                      words={words}
                    />
                  </li>
                );
              })}
            </ul>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/** A country's regions on a phone: a ranked list, each region opening to its criteria. */
export function RegionList({
  country,
  criteria,
  weightOf,
  preferences,
  change,
  words,
}: RegionProps) {
  const { t } = words;
  const countryName = words.country(country.country);
  return (
    <details>
      <summary className={`${textLinkClass} cursor-pointer`}>
        {t('compare.regions.show', { n: country.regions.length })}
      </summary>
      <p className="mt-2 text-small text-muted">{t('compare.regions.lead')}</p>
      <ol className={`${cardClass} mt-2 flex flex-col divide-y divide-line`}>
        {country.regions.map((region) => {
          const name = words.region(region.region);
          const scores = scoresOf(region);
          return (
            <li key={region.region}>
              <details className="group">
                <summary className="flex cursor-pointer items-baseline gap-3 p-3">
                  {region.rank !== null && (
                    <span
                      aria-hidden="true"
                      className={`tabular-nums ${region.rank === 1 ? 'text-primary' : 'text-muted'}`}
                    >
                      {region.rank}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 break-words">
                    {region.rank !== null && (
                      <span className="sr-only">
                        {t('compare.regions.place', {
                          rank: String(region.rank),
                          country: countryName,
                        })}{' '}
                      </span>
                    )}
                    {name}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {region.total === null ? (
                      <span className="text-small text-muted">{t('compare.noTotal')}</span>
                    ) : (
                      <>
                        <span aria-hidden="true">{words.decimal(region.total)}</span>
                        <span className="sr-only">
                          {t('compare.totalLabel', { total: words.decimal(region.total) })}
                        </span>
                      </>
                    )}
                  </span>
                </summary>
                <ul className="flex flex-col divide-y divide-line px-3">
                  {criteria.map((criterion) => {
                    const score = scores.get(criterion.id);
                    return (
                      <CriterionLine
                        key={criterion.id}
                        criterion={criterion}
                        weight={weightOf(criterion)}
                        score={score}
                        rating={preferences.ratings[criterion.id]?.[region.region]}
                        place={region.region}
                        placeName={name}
                        regional
                        inheritedStars={score?.countryStars}
                        change={change}
                        words={words}
                      />
                    );
                  })}
                </ul>
              </details>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
