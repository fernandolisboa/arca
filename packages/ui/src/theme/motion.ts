/** Motion tokens (spec 0006, Shape, space and motion). Zeroed when motion is off or reduced. */
export const motion = {
  durationFast: '150ms',
  durationBase: '250ms',
  durationSlow: '450ms',
  staggerStep: '90ms',
  easeOut: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
} as const;

/** Bars stagger only for the first rows; later rows start with the last of them. */
export const staggeredRows = 6;
