import type { ButtonHTMLAttributes } from 'react';

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>;

/** The primary button, never smaller than the 44 px touch target. */
export function Button({ type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-control bg-primary px-4 font-medium text-on-primary hover:bg-primary-hover active:bg-primary-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
      {...props}
    />
  );
}
