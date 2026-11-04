import { useId } from 'react';
import { Bar } from './bar.js';

export interface ProgressBarProps {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  /** The value in words, such as "3 de 12". It is shown and read out. */
  readonly valueText: string;
}

/** Per-person and family progress: the ranking bar with a text label that carries the value. */
export function ProgressBar({ label, value, max, valueText }: ProgressBarProps) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-small">
        <span id={labelId}>{label}</span>
        {/* Read once, through aria-valuetext below. */}
        <span aria-hidden="true" className="text-muted tabular-nums">
          {valueText}
        </span>
      </div>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(Math.max(value, 0), max)}
        aria-valuetext={valueText}
      >
        <Bar ratio={max > 0 ? value / max : 0} />
      </div>
    </div>
  );
}
