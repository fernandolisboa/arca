import { StarRating } from '@arca/ui';
import type { ReactNode } from 'react';
import { type Edit, ratingEdit } from './edits.js';
import type { CompareWords, Criterion } from './words.js';

export const stickyCell = 'sticky left-0 z-10 bg-surface';

/** A ranked row's header: the place drawn by CSS beside the name, read once as "1º lugar …". */
export function PlaceHeader({
  rank,
  rankLabel,
  className = '',
  children,
}: {
  readonly rank: number | null;
  readonly rankLabel: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <th scope="row" className={`${stickyCell} p-3 text-left font-medium ${className}`}>
      <span className="flex items-baseline gap-2">
        {rank !== null && (
          <span
            aria-hidden="true"
            data-rank={rank}
            className={`tabular-nums before:content-[attr(data-rank)] ${rank === 1 ? 'text-primary' : 'text-muted'}`}
          />
        )}
        <span>
          {rank !== null && <span className="sr-only">{rankLabel} </span>}
          {children}
        </span>
      </span>
    </th>
  );
}

/** A country's or region's total out of 10 and how much of the weight it rests on. */
export function TotalCell({
  total,
  coverage,
  words,
}: {
  readonly total: string | null;
  readonly coverage: number;
  readonly words: CompareWords;
}) {
  const { t } = words;
  const shown = total === null ? null : words.decimal(total);
  return (
    <td className="p-3 whitespace-nowrap">
      {shown === null ? (
        <span className="text-small text-muted">{t('compare.noTotal')}</span>
      ) : (
        <span className="flex flex-col">
          <span className="font-display text-lead tabular-nums">
            <span aria-hidden="true">{shown}</span>
            <span className="sr-only">{t('compare.totalLabel', { total: shown })}</span>
          </span>
          <span className="text-caption text-muted">
            {t('compare.coverage', { coverage: String(coverage) })}
          </span>
        </span>
      )}
    </td>
  );
}

/** The person's stars for one criterion in one country or region, kept under its code. */
export function StarCell({
  criterion,
  place,
  placeName,
  rating,
  suggested,
  change,
  words,
}: {
  readonly criterion: Criterion;
  readonly place: string;
  readonly placeName: string;
  readonly rating: number | undefined;
  readonly suggested: number | undefined;
  readonly change: (edit: Edit) => void;
  readonly words: CompareWords;
}) {
  const { t } = words;
  const label = words.label(criterion);
  const rate = (stars: number | undefined) => {
    change(ratingEdit(criterion.id, place, stars));
  };
  return (
    <StarRating
      compact
      legend={t('compare.ratingFor', { criterion: label, country: placeName })}
      caption={t('compare.rating')}
      value={rating}
      onChange={rate}
      onClear={() => {
        rate(undefined);
      }}
      starLabel={(n) => t('compare.star', { n })}
      clearLabel={t('compare.clearStarsFor', { criterion: label, country: placeName })}
      suggested={suggested}
    />
  );
}
