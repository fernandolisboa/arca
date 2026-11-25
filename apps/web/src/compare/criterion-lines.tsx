import { staleAfterDays } from '@arca/api-contract/client';
import { StarRating, formatCalendarDate } from '@arca/ui';
import { textLinkClass } from '../forms/text-link.js';
import { type Edit, ratingEdit } from './edits.js';
import {
  measured,
  type CompareWords,
  type Criterion,
  type CriterionScore,
  type Reading,
  type Suggested,
} from './words.js';

/**
 * One criterion of a country or region (ADR-0042): its weight, score and what the score comes
 * from. A region's score taken from its country says so, and its stars start from the country's.
 */
export function CriterionLine({
  criterion,
  weight,
  score,
  rating,
  place,
  placeName,
  regional = false,
  inheritedStars,
  change,
  words,
}: {
  readonly criterion: Criterion;
  readonly weight: number;
  readonly score: CriterionScore | undefined;
  /** The person's stars as they just chose them. */
  readonly rating: number | undefined;
  /** The country or region code the stars are kept under. */
  readonly place: string;
  readonly placeName: string;
  /** The place is a region of its country (ADR-0042). */
  readonly regional?: boolean;
  /** For a region scored as its country, the stars that count there until the person rates it. */
  readonly inheritedStars?: number | undefined;
  readonly change: (edit: Edit) => void;
  readonly words: CompareWords;
}) {
  const { t } = words;
  const label = words.label(criterion);
  const objective = measured(criterion);
  const fromSuggestion = rating === undefined && score?.suggested !== undefined;
  const value =
    score?.score == null
      ? t(objective ? 'compare.noData' : 'compare.notRated')
      : score.inherited === true
        ? t('compare.regions.likeCountryScore', { score: words.decimal(score.score) })
        : fromSuggestion
          ? t('compare.suggested.scored', { score: words.decimal(score.score) })
          : words.decimal(score.score);
  const muted = score?.score == null || score.inherited === true;
  const rate = (stars: number | undefined) => {
    change(ratingEdit(criterion.id, place, stars));
  };
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
          className={`shrink-0 tabular-nums ${muted ? 'text-small text-muted' : 'font-medium'}`}
        >
          {value}
        </span>
      </div>
      {score?.reading !== undefined && (
        <ReadingLines criterion={criterion} reading={score.reading} words={words} />
      )}
      {!objective && (
        <StarRating
          legend={t('compare.ratingFor', { criterion: label, country: placeName })}
          caption={t('compare.rating')}
          value={rating}
          onChange={rate}
          onClear={() => {
            rate(undefined);
          }}
          starLabel={(n) => t('compare.star', { n })}
          clearLabel={t('compare.clearStars')}
          suggested={score?.suggested?.stars ?? inheritedStars}
        />
      )}
      {!objective && score?.suggested !== undefined && (
        <SuggestionLines
          suggested={score.suggested}
          regional={regional}
          rated={rating !== undefined}
          confirmLabel={t('compare.suggested.confirmFor', {
            criterion: label,
            country: placeName,
          })}
          onConfirm={rate}
          words={words}
        />
      )}
    </li>
  );
}

/** What an objective score comes from: the value and its year, then its source as plain text. */
export function ReadingLines({
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

/**
 * The stars Arca suggests (ADR-0035): how many, why, and the source as plain text. While the
 * person has not rated the country they score it, and one tap keeps them as the person's own.
 */
export function SuggestionLines({
  suggested,
  regional = false,
  rated,
  confirmLabel,
  onConfirm,
  words,
}: {
  readonly suggested: Suggested;
  /** The stars are a region's, read from the region's own data (ADR-0042). */
  readonly regional?: boolean;
  /** The person already gave their own stars, which count instead. */
  readonly rated: boolean;
  readonly confirmLabel: string;
  readonly onConfirm: (stars: number) => void;
  readonly words: CompareWords;
}) {
  const { t } = words;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-small">
        <span className="font-medium">{t('compare.suggested.stars', { n: suggested.stars })}</span>{' '}
        · {words.suggestionReason(suggested, regional)}
      </p>
      <p className="text-caption break-all text-muted">
        {t('compare.source', {
          url: suggested.source.url,
          date: formatCalendarDate(suggested.source.verifiedAt, words.language),
        })}
      </p>
      {suggested.stale && (
        <p className="text-caption text-warn-ink">
          {t('compare.stale', { days: String(staleAfterDays) })}
        </p>
      )}
      {!rated && (
        <button
          type="button"
          className={`${textLinkClass} self-start text-small`}
          aria-label={confirmLabel}
          onClick={() => {
            onConfirm(suggested.stars);
          }}
        >
          {t('compare.suggested.confirm')}
        </button>
      )}
    </div>
  );
}
