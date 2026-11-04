/** An email address as the API takes it. */
export const emailInput = {
  name: 'email',
  type: 'email',
  required: true,
  maxLength: 254,
  autoComplete: 'email',
} as const;

/** A recovery code or secret as people type it: no autofill, no autocorrect. */
export const recoveryCodeInput = {
  name: 'recovery-code',
  type: 'text',
  required: true,
  maxLength: 64,
  autoComplete: 'off',
  autoCapitalize: 'characters',
  autoCorrect: 'off',
  spellCheck: false,
} as const;
