import { describe, expect, it } from 'vitest';
import {
  generateRecoverySecret,
  generateVaultIdentity,
  normalizeRecoverySecret,
  openRecoveryEnvelope,
  recipientOf,
  sealRecoveryEnvelope,
  WrongRecoverySecret,
} from '../src/index.js';

describe('the recovery envelope (spec 0005, R1)', () => {
  it('generates 128-bit secrets as 26 Crockford base32 symbols', () => {
    const secret = generateRecoverySecret();
    expect(secret).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(generateRecoverySecret()).not.toBe(secret);
  });

  it.each([
    ['grouped and lower case', (secret: string) => secret.toLowerCase().replace(/(.{4})/g, '$1-')],
    ['with spaces', (secret: string) => secret.replace(/(.{5})/g, '$1 ')],
  ])('accepts a secret typed %s', (_case, typed) => {
    const secret = generateRecoverySecret();
    expect(normalizeRecoverySecret(typed(secret))).toBe(secret);
  });

  it('reads I, L and O as the digits they look like', () => {
    expect(normalizeRecoverySecret('O'.repeat(25) + '0')).toBe('0'.repeat(26));
    expect(normalizeRecoverySecret('IL' + '0'.repeat(24))).toBe('11' + '0'.repeat(24));
  });

  it.each(['', 'too-short', 'U'.repeat(26), '0'.repeat(27), '0'.repeat(25) + 'Z'])(
    'refuses %j',
    (typed) => {
      expect(normalizeRecoverySecret(typed)).toBeUndefined();
    },
  );

  it('opens with its secret, however it is typed, and with nothing else', async () => {
    const identity = await generateVaultIdentity();
    const secret = generateRecoverySecret();
    const envelope = await sealRecoveryEnvelope(identity, secret);
    const opened = await openRecoveryEnvelope(envelope, secret.toLowerCase());
    expect(opened).toEqual(identity);
    expect(await recipientOf(opened)).toBe(await recipientOf(identity));
    await expect(openRecoveryEnvelope(envelope, generateRecoverySecret())).rejects.toBeInstanceOf(
      WrongRecoverySecret,
    );
    await expect(openRecoveryEnvelope(envelope, 'not a secret')).rejects.toBeInstanceOf(
      WrongRecoverySecret,
    );
  }, 30_000);

  it('is an age file with one scrypt stanza', async () => {
    const envelope = await sealRecoveryEnvelope(
      await generateVaultIdentity(),
      generateRecoverySecret(),
    );
    const header = new TextDecoder().decode(envelope.subarray(0, 200));
    expect(header).toMatch(/^age-encryption\.org\/v1\n-> scrypt \S+ 18\n/);
  }, 30_000);
});
