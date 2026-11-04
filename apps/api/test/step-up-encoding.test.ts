import { describe, expect, it } from 'vitest';
import { StepUpAction, StepUpOptionsRequest } from '@arca/api-contract/routes';
import { stepUpChallenge, subjectHash } from '../src/auth/step-up-encoding.js';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const filled = (length: number, value: number) => new Uint8Array(length).fill(value);

// Computed independently of this code (Python's hashlib over the same length-prefixed fields).
const vector = {
  action: {
    action: 'revokeSession',
    targets: ['3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b'],
    fields: { currency: 'BRL', amount: '1250' },
    nonce: filled(16, 0x33),
  },
  subject: '92eb4121614939566979311148f23852dbcaa83617732271396101b531b48c6e',
  serverNonce: filled(32, 0x22),
  challenge: '6a4924ec208d605ddc04f8d0090aa68b1a78708c1628b13717396bfbc823cada',
  vaultChallenge: '293602bb5b2a3200592d123591333b72db8929a50eca8f14621373739a3e5080',
};

describe('the step-up encoding (spec 0003, R5)', () => {
  it('matches the committed test vector', () => {
    const subject = subjectHash(vector.action);
    expect(hex(subject)).toBe(vector.subject);
    expect(hex(stepUpChallenge('sensitive_settings', subject, vector.serverNonce))).toBe(
      vector.challenge,
    );
    expect(hex(stepUpChallenge('vault_unlock', new Uint8Array(0), vector.serverNonce))).toBe(
      vector.vaultChallenge,
    );
  });

  it('does not depend on the order the fields were sent in', () => {
    const reordered = { ...vector.action, fields: { amount: '1250', currency: 'BRL' } };
    expect(hex(subjectHash(reordered))).toBe(vector.subject);
  });

  it.each([
    ['another action', { action: 'regenerateRecoveryKit' }],
    ['another target', { targets: ['6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b'] }],
    ['the targets split differently', { targets: ['3f2b8a4e-6c1d-4e5f', '-9a7b-0c1d2e3f4a5b'] }],
    ['another amount', { fields: { currency: 'BRL', amount: '1251' } }],
    ['a field moved into a target', { fields: { currency: 'BRL' }, targets: ['amount', '1250'] }],
    ['another nonce', { nonce: filled(16, 0x34) }],
  ])('gives %s another subject', (_, change) => {
    expect(hex(subjectHash({ ...vector.action, ...change }))).not.toBe(vector.subject);
  });

  it('binds the challenge to the purpose, the subject and the nonce', () => {
    const subject = subjectHash(vector.action);
    const challenges = [
      stepUpChallenge('sensitive_settings', subject, vector.serverNonce),
      stepUpChallenge('data_export', subject, vector.serverNonce),
      stepUpChallenge('sensitive_settings', filled(32, 0), vector.serverNonce),
      stepUpChallenge('sensitive_settings', subject, filled(32, 0x23)),
    ].map(hex);
    expect(new Set(challenges).size).toBe(challenges.length);
  });
});

describe('the step-up options request', () => {
  const target = {
    action: 'revokeSession',
    targets: ['3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b'],
    nonce: 'MzMzMzMzMzMzMzMzMzMzMw',
  };

  it('takes a target for every purpose but vault_unlock', () => {
    expect(StepUpOptionsRequest.safeParse({ purpose: 'sensitive_settings', target }).success).toBe(
      true,
    );
    expect(StepUpOptionsRequest.safeParse({ purpose: 'vault_unlock' }).success).toBe(true);
  });

  it('refuses a subject for vault_unlock and a missing one for any other purpose', () => {
    expect(StepUpOptionsRequest.safeParse({ purpose: 'vault_unlock', target }).success).toBe(false);
    expect(StepUpOptionsRequest.safeParse({ purpose: 'sensitive_settings' }).success).toBe(false);
  });

  it.each([
    ['a short nonce', { nonce: 'MzMzMzMzMzMzMzMzMzMz' }],
    ['a nonce over 128 bits', { nonce: 'MzMzMzMzMzMzMzMzMzMzMzM' }],
    ['an action that is no operation ID', { action: 'revoke-session' }],
    [
      'too many fields',
      { fields: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`f${String(i)}`, 'x'])) },
    ],
  ])('refuses %s', (_, change) => {
    expect(StepUpAction.safeParse({ ...target, ...change }).success).toBe(false);
  });
});
