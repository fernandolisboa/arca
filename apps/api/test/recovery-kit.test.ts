import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { crockfordBase32, recoveryCodeHash } from '../src/auth/recovery-kit.js';

describe('the recovery code (spec 0003, R6)', () => {
  it.each([
    [Buffer.from(Array.from({ length: 16 }, (_, index) => index)), '000G40R40M30E209185GR38E1W'],
    [Buffer.alloc(16, 0xff), 'ZZZZZZZZZZZZZZZZZZZZZZZZZW'],
    [Buffer.alloc(16), '0'.repeat(26)],
  ])('encodes 128 bits as 26 Crockford base32 symbols', (bytes, symbols) => {
    expect(crockfordBase32(bytes)).toBe(symbols);
  });

  it('hashes the salt and then the code', () => {
    const salt = Buffer.alloc(16, 7);
    expect(recoveryCodeHash(salt, 'ABC')).toEqual(
      createHash('sha256')
        .update(Buffer.concat([salt, Buffer.from('ABC')]))
        .digest(),
    );
  });
});
