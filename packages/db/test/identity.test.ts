import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/database.js';
import { InvalidIdentityError, withIdentity } from '../src/identity.js';

const personId = '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b';

function databaseSpy() {
  const transaction = vi.fn();
  return { db: { transaction } as unknown as Database, transaction };
}

describe('withIdentity', () => {
  it.each([
    ['an empty person', { personId: '' }],
    ['a person that is not a UUID', { personId: 'not-a-uuid' }],
    ['an injection attempt', { personId: `${personId}', true); DROP TABLE x; --` }],
    ['a UUID with a trailing newline', { personId: `${personId}\n` }],
    ['a case that is not a UUID', { personId, caseId: '42' }],
    ['a person that is not a string', { personId: 42 as unknown as string }],
  ])('rejects %s before any SQL runs', async (_label, identity) => {
    const { db, transaction } = databaseSpy();
    await expect(withIdentity(db, identity, () => Promise.resolve())).rejects.toBeInstanceOf(
      InvalidIdentityError,
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});
