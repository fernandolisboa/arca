import { useId } from 'react';
import { Icon } from '../icon.js';

export interface StarRatingProps {
  /** What is rated, for screen readers, such as "Clima em Portugal". */
  readonly legend: string;
  /** From 1 to 5; undefined while not rated. */
  readonly value: number | undefined;
  readonly onChange: (value: number) => void;
  /** Takes the rating away; the clear button shows only while there is one. */
  readonly onClear: () => void;
  /** Each star in words, such as "3 de 5 estrelas". */
  readonly starLabel: (stars: number) => string;
  readonly clearLabel: string;
}

const stars = [1, 2, 3, 4, 5] as const;

/**
 * One to five stars as native radios, so arrow keys and screen readers work; a star and every
 * star before it fill when chosen. A rating is taken away with the clear button beside them.
 */
export function StarRating({
  legend,
  value,
  onChange,
  onClear,
  starLabel,
  clearLabel,
}: StarRatingProps) {
  const groupId = useId();
  return (
    <fieldset className="flex flex-wrap items-center gap-x-2">
      <legend className="sr-only">{legend}</legend>
      <div className="flex">
        {stars.map((star) => (
          <label
            key={star}
            className={`relative flex min-h-touch min-w-touch cursor-pointer items-center justify-center rounded-control hover:bg-soft has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-primary ${
              value !== undefined && star <= value
                ? 'text-accent [&>svg]:fill-current'
                : 'text-muted'
            }`}
          >
            <input
              type="radio"
              name={groupId}
              value={star}
              checked={star === value}
              onChange={() => {
                onChange(star);
              }}
              className="absolute inset-0 m-0 cursor-pointer appearance-none opacity-0"
            />
            <span className="sr-only">{starLabel(star)}</span>
            <Icon name="star" size={22} />
          </label>
        ))}
      </div>
      {value !== undefined && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex min-h-touch items-center px-1 text-small text-muted underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {clearLabel}
        </button>
      )}
    </fieldset>
  );
}
