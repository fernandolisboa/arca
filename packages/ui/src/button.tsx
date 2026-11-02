import type { ButtonHTMLAttributes } from 'react';

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>;

/** The primary button, never smaller than the 44 px touch target. */
export function Button({ type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-md bg-brand px-4 font-medium text-on-brand hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
      {...props}
    />
  );
}
