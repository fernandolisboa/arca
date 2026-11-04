import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const resolvedFile = (specifier: string, from: string) =>
  realpathSync(createRequire(from).resolve(specifier));

describe('@simplewebauthn/server (ADR-0015)', () => {
  it('is the one copy the passkey plugin resolves, so step-up and sign-in verify alike', () => {
    const own = resolvedFile('@simplewebauthn/server', import.meta.url);
    const plugin = resolvedFile('@better-auth/passkey', import.meta.url);
    expect(resolvedFile('@simplewebauthn/server', plugin)).toBe(own);
  });
});
