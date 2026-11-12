import type { StatusTone } from '@arca/ui';
import { useId } from 'react';
import { SelectField } from '../forms/select-field.js';
import { type ReviewFilter, type ReviewNeed, reviewNeeds, toggleNeed } from './review-order.js';
import type { KnowledgeWords } from './words.js';

/** A need's tone, for its chip in the list and its dot in the filter. */
export const needTone: Readonly<Record<ReviewNeed, StatusTone>> = {
  differs: 'danger',
  ready: 'ok',
  unread: 'unknown',
  unchecked: 'unknown',
};

const toneInk: Readonly<Record<StatusTone, string>> = {
  danger: 'text-danger-ink',
  ok: 'text-ok-ink',
  warn: 'text-warn-ink',
  unknown: 'text-muted',
};

/**
 * Narrows the proposed versions to one country and to any of the needs, each need saying how many
 * versions it would show.
 */
export function ReviewFilters({
  countries,
  counts,
  filter,
  onChange,
  words,
}: {
  /** The countries with a proposed version, in display order. */
  readonly countries: readonly string[];
  readonly counts: Readonly<Record<ReviewNeed, number>>;
  readonly filter: ReviewFilter;
  readonly onChange: (filter: ReviewFilter) => void;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const needsId = useId();
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-6">
      <div className="md:w-56 md:shrink-0">
        <SelectField
          label={t('knowledge.review.filter.country')}
          placeholder={t('knowledge.review.filter.allCountries')}
          value={filter.country ?? ''}
          options={countries.map((country) => ({ value: country, label: words.country(country) }))}
          onChange={(country) => {
            onChange({ ...filter, country: country === '' ? null : country });
          }}
        />
      </div>
      <div role="group" aria-labelledby={needsId} className="flex min-w-0 flex-col gap-1">
        <span id={needsId} className="font-medium">
          {t('knowledge.review.filter.needs')}
        </span>
        <div className="flex flex-wrap gap-2">
          {reviewNeeds.map((need) => (
            <button
              key={need}
              type="button"
              aria-pressed={filter.needs.has(need)}
              onClick={() => {
                onChange(toggleNeed(filter, need));
              }}
              className="inline-flex min-h-touch items-center gap-2 rounded-control border border-line bg-surface px-3 text-small hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-pressed:border-primary aria-pressed:bg-soft aria-pressed:font-medium"
            >
              <span
                aria-hidden="true"
                className={`size-2 rounded-full bg-current ${toneInk[needTone[need]]}`}
              />
              {t('knowledge.review.need', { need })}{' '}
              <span className="text-muted tabular-nums">{counts[need]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
