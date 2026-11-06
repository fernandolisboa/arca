/**
 * An item of an in-page menu, such as Settings' categories or a review's steps: a bordered chip in
 * a row on narrow screens, a plain row with an accent bar on its left from 1024 px. The current
 * item carries `data-current`, next to the `aria-current` that names it to screen readers.
 */
export const menuItemClass =
  'flex min-h-touch w-full items-center gap-3 rounded-control border border-line px-3 text-left whitespace-nowrap text-muted hover:bg-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary data-current:border-primary data-current:bg-soft data-current:font-medium data-current:text-ink lg:border-transparent lg:whitespace-normal lg:data-current:border-transparent lg:data-current:shadow-[inset_3px_0_0_var(--arca-primary)]';
