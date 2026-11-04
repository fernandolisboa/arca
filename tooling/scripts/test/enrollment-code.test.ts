import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { enrollmentCode } from '../src/enrollment-code.ts';

describe('pnpm enrollment-code (spec 0003, R2)', () => {
  it('draws 128 bits and prints them as base64url with their SHA-256', () => {
    const sizes: number[] = [];
    const { code, hash } = enrollmentCode((size) => {
      sizes.push(size);
      return Buffer.alloc(size, 0xab);
    });
    expect(sizes).toEqual([16]);
    expect(code).toBe(Buffer.alloc(16, 0xab).toString('base64url'));
    expect(hash).toBe(createHash('sha256').update(code).digest('hex'));
  });

  it('gives a different code every time', () => {
    expect(enrollmentCode().code).not.toBe(enrollmentCode().code);
  });
});
