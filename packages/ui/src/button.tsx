import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  /** `secondary` is the quieter outlined button beside a primary one, such as "Voltar". */
  readonly variant?: 'primary' | 'secondary';
}

const variants = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-pressed',
  secondary: 'border border-line bg-surface text-ink hover:bg-soft',
} as const;

/** A button's classes, also for a link that should look like one. */
export function buttonClass(variant: NonNullable<ButtonProps['variant']> = 'primary'): string {
  return `inline-flex min-h-touch min-w-touch items-center justify-center gap-2 rounded-control px-4 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60 ${variants[variant]}`;
}

/** A button, never smaller than the 44 px touch target. */
export function Button({ type = 'button', variant = 'primary', ...props }: ButtonProps) {
  return <button type={type} className={buttonClass(variant)} {...props} />;
}
