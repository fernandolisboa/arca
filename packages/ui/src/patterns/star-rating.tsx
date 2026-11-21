import { useId } from 'react';
import { Icon } from '../icon.js';

export interface StarRatingProps {
  /** What is rated, for screen readers, such as "Sua nota para Clima em Portugal". */
  readonly legend: string;
  /** The short label shown beside the stars, such as "Sua nota"; the legend says it in full. */
  readonly caption: string;
  /** From 1 to 5; undefined while not rated. */
  readonly value: number | undefined;
  readonly onChange: (value: number) => void;
  /** Takes the rating away; the clear button shows only while there is one. */
  readonly onClear: () => void;
  /** Each star in words, such as "3 de 5 estrelas". */
  readonly starLabel: (stars: number) => string;
  readonly clearLabel: string;
  /** Smaller stars and no caption, for a table cell on a wide screen with a pointer. */
  readonly compact?: boolean;
}

const stars = [1, 2, 3, 4, 5] as const;

/**
 * One to five stars as native radios, so arrow keys and screen readers work; a star and every
 * star before it fill when chosen. A rating is taken away with the clear button beside them.
 */
export function StarRating({
  legend,
  caption,
  value,
  onChange,
  onClear,
  starLabel,
  clearLabel,
  compact = false,
}: StarRatingProps) {
  const groupId = useId();
  return (
    <fieldset className={`flex items-center ${compact ? 'gap-x-1' : 'flex-wrap gap-x-2'}`}>
      <legend className="sr-only">{legend}</legend>
      {!compact && (
        <span aria-hidden="true" className="text-small text-muted">
          {caption}
        </span>
      )}
      <div className="flex">
        {stars.map((star) => (
          <label
            key={star}
            className={`relative flex ${compact ? 'size-7' : 'min-h-touch min-w-touch'} cursor-pointer items-center justify-center rounded-control hover:bg-soft has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-primary ${
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
            <Icon name="star" size={compact ? 16 : 22} />
          </label>
        ))}
      </div>
      {value !== undefined && (
        <button
          type="button"
          onClick={onClear}
          aria-label={compact ? clearLabel : undefined}
          className={`inline-flex ${compact ? 'size-7 justify-center' : 'min-h-touch px-1'} items-center text-small text-muted underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
        >
          {compact ? <Icon name="close" size={14} /> : clearLabel}
        </button>
      )}
      {compact && value === undefined && <span aria-hidden="true" className="size-7" />}
    </fieldset>
  );
}
