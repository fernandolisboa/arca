import { useId } from 'react';
import { TextField } from '../forms/text-field.js';
import { scoreFilters, type CountryFilter } from './filters.js';
import type { CompareWords } from './words.js';

/** The search by country name and the choice between all countries, scored or not. */
export function CompareToolbar({
  filter,
  onChange,
  words,
}: {
  readonly filter: CountryFilter;
  readonly onChange: (filter: CountryFilter) => void;
  readonly words: CompareWords;
}) {
  const { t } = words;
  const groupId = useId();
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
      <div className="w-full sm:w-72">
        <TextField
          type="search"
          label={t('compare.searchLabel')}
          value={filter.search}
          onChange={(event) => {
            onChange({ ...filter, search: event.target.value });
          }}
          autoComplete="off"
        />
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-medium">{t('compare.scoreFilter')}</legend>
        <div className="flex rounded-control border border-line bg-surface p-0.5">
          {scoreFilters.map((score) => (
            <label
              key={score}
              className="relative flex min-h-touch cursor-pointer items-center rounded-control px-3 text-small hover:bg-soft has-checked:bg-primary has-checked:text-on-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary"
            >
              <input
                type="radio"
                name={groupId}
                value={score}
                checked={filter.score === score}
                onChange={() => {
                  onChange({ ...filter, score });
                }}
                className="absolute inset-0 m-0 cursor-pointer appearance-none opacity-0"
              />
              {t('compare.scoreFilterChoice', { score })}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
