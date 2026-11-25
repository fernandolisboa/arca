import { useId, type ReactNode } from 'react';

export interface Choice<V extends string> {
  readonly value: V;
  readonly label: string;
  /** A small live sample beside the label, such as color swatches or the font itself. */
  readonly preview?: ReactNode;
}

export interface ChoiceGroupProps<V extends string> {
  readonly legend: string;
  readonly description?: string;
  readonly choices: readonly Choice<V>[];
  /** The checked choice. */
  readonly value: V;
  readonly onChange: (value: V) => void;
  /** Short answers side by side, each as wide as its label, instead of a full-width grid. */
  readonly inline?: boolean;
  /** Keeps the legend and description for screen readers only, where the screen shows them elsewhere. */
  readonly legendHidden?: boolean;
  /** Shown above the answers, inside the group, such as what is already recorded. */
  readonly before?: ReactNode;
}

/**
 * One question with a few answers, as native radio buttons inside a fieldset, so arrow keys,
 * labels and screen readers work without extra code. Each answer is a touch target, full width
 * unless `inline`.
 */
export function ChoiceGroup<V extends string>({
  legend,
  description,
  choices,
  value,
  onChange,
  inline = false,
  legendHidden = false,
  before,
}: ChoiceGroupProps<V>) {
  const groupId = useId();
  const descriptionId = `${groupId}-description`;
  return (
    <fieldset
      className="flex flex-col gap-2"
      {...(description === undefined ? {} : { 'aria-describedby': descriptionId })}
    >
      <legend className={legendHidden ? 'sr-only' : 'mb-2 font-medium'}>{legend}</legend>
      {description !== undefined && (
        <p
          id={descriptionId}
          className={legendHidden ? 'sr-only' : '-mt-1 mb-1 text-small text-muted'}
        >
          {description}
        </p>
      )}
      {before}
      <div
        className={
          inline ? 'flex flex-wrap gap-2' : 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3'
        }
      >
        {choices.map((choice) => (
          <label
            key={choice.value}
            className="flex min-h-touch cursor-pointer items-center gap-3 rounded-control border border-line bg-surface px-3 py-2 transition-colors hover:bg-soft has-checked:border-primary has-checked:bg-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary"
          >
            <input
              type="radio"
              name={groupId}
              value={choice.value}
              checked={choice.value === value}
              onChange={() => {
                onChange(choice.value);
              }}
              className="size-4 shrink-0 accent-(--arca-primary)"
            />
            <span className="min-w-0 flex-1">{choice.label}</span>
            {choice.preview}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
