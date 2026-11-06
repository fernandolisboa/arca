const quietAction =
  'inline-flex min-h-touch items-center self-start font-medium underline decoration-2 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60';

/** An inline link or a quiet action, underlined in the accent color, at the touch height. */
export const textLinkClass = `${quietAction} text-ink decoration-accent`;

/** A quiet action that destroys something, in the danger color. */
export const dangerLinkClass = `${quietAction} text-danger-ink decoration-danger-ink`;
