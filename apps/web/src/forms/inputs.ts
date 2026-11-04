/** An email address as the API takes it. */
export const emailInput = {
  name: 'email',
  type: 'email',
  required: true,
  maxLength: 254,
  autoComplete: 'email',
} as const;
