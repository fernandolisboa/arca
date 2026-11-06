import { useId, type ReactNode } from 'react';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectFieldProps {
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  /** Shown first, with an empty value, while nothing is chosen. */
  readonly placeholder?: string;
  /** Further groups of options, such as former states after the countries. */
  readonly children?: ReactNode;
}

export const selectClass =
  'min-h-touch rounded-control border border-line bg-surface px-3 text-body text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** A labelled native select at the touch target's height, which phones open as their own picker. */
export function SelectField({
  label,
  hint,
  value,
  onChange,
  options,
  placeholder,
  children,
}: SelectFieldProps) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <select
        id={id}
        className={selectClass}
        value={value}
        aria-describedby={hint === undefined ? undefined : hintId}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {children}
      </select>
      {hint !== undefined && (
        <p id={hintId} className="text-small text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
