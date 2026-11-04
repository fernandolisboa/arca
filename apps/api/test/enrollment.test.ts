import { createHash } from 'node:crypto';
import { createI18n } from '@arca/i18n';
import { describe, expect, it } from 'vitest';
import { enrollmentMessage, ownerCode } from '../src/auth/enrollment.js';

const code = 'c29tZS1zeW50aGV0aWMtY29kZQ';
const hash = createHash('sha256').update(code).digest('hex');

describe('the owner enrollment code (spec 0003, R2)', () => {
  it('matches only the configured code, and returns its hash', () => {
    const matching = ownerCode(hash);
    expect(matching(code)?.toString('hex')).toBe(hash);
    expect(matching(`${code}x`)).toBeNull();
    expect(matching(undefined)).toBeNull();
  });

  it('matches nothing while no hash is configured', () => {
    expect(ownerCode(null)(code)).toBeNull();
  });
});

describe('the enrollment email (spec 0003, R2 and R8)', () => {
  it('carries the token only in the link fragment', async () => {
    const message = enrollmentMessage(
      await createI18n(),
      'https://arca.example.com',
      'owner@example.com',
      'synthetic-token',
    );
    expect(message.to).toBe('owner@example.com');
    expect(message.text).toContain('https://arca.example.com/enroll#synthetic-token');
    expect(message.subject).not.toContain('synthetic-token');
  });
});
