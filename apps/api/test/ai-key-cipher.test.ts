import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { aiKeyCipher, type AiKeyBinding } from '../src/ai/key-cipher.js';

// Synthetic keys only.
const key = `sk-ant-api03-${'synthetic'.repeat(4)}`;
const binding: AiKeyBinding = {
  environment: 'production',
  keyId: '7d3c1d2e-7c43-4b8e-9f55-0a6c9b1d2e3f',
  provider: 'anthropic',
};

describe('the AI key cipher (ADR-0031)', () => {
  const cipher = aiKeyCipher(randomBytes(32));

  it('opens what it sealed, with a fresh nonce and a 16-byte tag each time', () => {
    const first = cipher.seal(key, binding);
    const second = cipher.seal(key, binding);
    expect(first.nonce).toHaveLength(12);
    expect(first.tag).toHaveLength(16);
    expect(first.nonce.equals(second.nonce)).toBe(false);
    expect(first.ciphertext.toString('utf8')).not.toContain('sk-ant-');
    expect(cipher.open(first, binding)).toBe(key);
    expect(cipher.open(second, binding)).toBe(key);
  });

  it.each([
    ['another environment', { ...binding, environment: 'preview' as const }],
    ['another row', { ...binding, keyId: '00000000-0000-4000-8000-000000000000' }],
    ['another provider', { ...binding, provider: 'typesafe' }],
  ])('fails closed for %s', (_, other) => {
    expect(cipher.open(cipher.seal(key, binding), other)).toBeUndefined();
  });

  it('fails closed for a tampered ciphertext, tag, format or key-encryption key', () => {
    const sealed = cipher.seal(key, binding);
    const flipped = Buffer.from(sealed.ciphertext);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(cipher.open({ ...sealed, ciphertext: flipped }, binding)).toBeUndefined();
    expect(cipher.open({ ...sealed, tag: randomBytes(16) }, binding)).toBeUndefined();
    expect(cipher.open({ ...sealed, tag: sealed.tag.subarray(0, 12) }, binding)).toBeUndefined();
    expect(cipher.open({ ...sealed, formatVersion: 2 }, binding)).toBeUndefined();
    const rotated = aiKeyCipher(randomBytes(32));
    expect(rotated.kekVersion).not.toBe(cipher.kekVersion);
    expect(rotated.open(sealed, binding)).toBeUndefined();
    expect(rotated.open({ ...sealed, kekVersion: rotated.kekVersion }, binding)).toBeUndefined();
  });

  it('refuses a key-encryption key that is not 32 bytes', () => {
    expect(() => aiKeyCipher(randomBytes(16))).toThrow();
  });
});
