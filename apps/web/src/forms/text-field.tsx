import { useId, type InputHTMLAttributes } from 'react';

export type TextFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'id' | 'aria-describedby'
> & {
  readonly label: string;
  readonly hint?: string;
  /** Shows dots for a secret kept out of password managers, which a password field invites. */
  readonly masked?: boolean;
};

/** A labelled text input at the touch target's height, with an optional hint below it. */
export function TextField({ label, hint, masked = false, ...input }: TextFieldProps) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hint === undefined ? undefined : hintId}
        className={`min-h-touch rounded-control border border-line bg-surface px-3 text-body text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary${masked ? ' [-webkit-text-security:disc]' : ''}`}
        {...input}
      />
      {hint !== undefined && (
        <p id={hintId} className="text-small text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
