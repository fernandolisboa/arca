import { useId } from 'react';

export interface ScaleChoiceProps {
  readonly legend: string;
  /** Read after the legend, such as what the ends of the scale mean. */
  readonly description?: string;
  readonly min: number;
  readonly max: number;
  readonly value: number;
  readonly onChange: (value: number) => void;
}

/**
 * A short whole-number scale, such as a weight from 0 to 5, as one row of native radios: arrow keys
 * move along it, and each step is a touch target that fills the row's width.
 */
export function ScaleChoice({ legend, description, min, max, value, onChange }: ScaleChoiceProps) {
  const groupId = useId();
  const descriptionId = `${groupId}-description`;
  const steps = Array.from({ length: Math.max(max - min + 1, 0) }, (_, index) => min + index);
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-2"
      {...(description === undefined ? {} : { 'aria-describedby': descriptionId })}
    >
      <legend className="mb-2 font-medium break-words">{legend}</legend>
      {description !== undefined && (
        <p id={descriptionId} className="-mt-1 text-small text-muted">
          {description}
        </p>
      )}
      <div className="grid auto-cols-fr grid-flow-col rounded-control border border-line">
        {steps.map((step) => (
          <label
            key={step}
            className="relative flex min-h-touch cursor-pointer items-center justify-center border-line font-medium tabular-nums transition-colors not-first:border-l first:rounded-l-control last:rounded-r-control hover:bg-soft has-checked:bg-primary has-checked:text-on-primary has-focus-visible:z-10 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary"
          >
            <input
              type="radio"
              name={groupId}
              value={step}
              checked={step === value}
              onChange={() => {
                onChange(step);
              }}
              className="absolute inset-0 m-0 cursor-pointer appearance-none opacity-0"
            />
            {step}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
