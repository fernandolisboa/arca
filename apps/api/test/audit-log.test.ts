import type { Database } from '@arca/db';
import { describe, expect, it } from 'vitest';
import { auditLog, InvalidAuditEventError, type AuditRecord } from '../src/audit/log.js';

const account = '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b';
const registeredId = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';

function recorder() {
  const statements: unknown[] = [];
  const db = {
    execute: (statement: unknown) => {
      statements.push(statement);
      return Promise.resolve();
    },
  } as unknown as Database;
  return { log: auditLog(db), statements };
}

const valid: AuditRecord<'passkey_added'> = {
  code: 'passkey_added',
  subjectAccountId: account,
  actorAccountId: account,
  details: { passkeyId: registeredId },
};

describe('the audit log writer (spec 0003, R7)', () => {
  it('inserts an event whose details match its code', async () => {
    const { log, statements } = recorder();
    await log.record(valid);
    expect(statements).toHaveLength(1);
  });

  it.each([
    [
      'a details key outside the allow-list',
      { ...valid, details: { ...valid.details, email: 'owner@example.com' } },
    ],
    [
      'a details value of the wrong kind',
      { ...valid, details: { passkeyId: 'owner@example.com' } },
    ],
    ['a missing details key', { ...valid, details: {} }],
    [
      'an enum value outside its list',
      {
        code: 'step_up_verified',
        subjectAccountId: account,
        actorAccountId: account,
        details: { purpose: 'anything' },
      },
    ],
    ['an unknown code', { ...valid, code: 'password_changed' }],
    ['an inherited property as the code', { ...valid, code: 'toString' }],
    ['a subject that is not an account ID', { ...valid, subjectAccountId: 'owner@example.com' }],
    ['an actor that is not an account ID', { ...valid, actorAccountId: 'someone' }],
    ['a request ID that is not one', { ...valid, requestId: 'GET /v1/session?email=x' }],
  ])('rejects %s before any insert', async (_label, entry) => {
    const { log, statements } = recorder();
    await expect(log.record(entry as AuditRecord)).rejects.toThrow(InvalidAuditEventError);
    expect(statements).toEqual([]);
  });

  it('never puts the rejected value in the error message', async () => {
    const { log } = recorder();
    await expect(
      log.record({ ...valid, details: { passkeyId: 'owner@example.com' } }),
    ).rejects.toThrow('audit event passkey_added is not allowed');
  });

  it('does not repeat an unknown code in the error message', async () => {
    const { log } = recorder();
    await expect(
      log.record({ ...valid, code: 'owner@example.com' } as unknown as AuditRecord),
    ).rejects.toThrow(/^unknown audit event code$/);
  });

  it('accepts a system event with no actor', async () => {
    const { log, statements } = recorder();
    await log.record({
      code: 'invite_expired',
      subjectAccountId: account,
      actorAccountId: null,
      details: { inviteId: registeredId },
    });
    expect(statements).toHaveLength(1);
  });
});
