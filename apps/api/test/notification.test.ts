import { describe, expect, it } from 'vitest';
import { noticeKinds } from '../src/email/notices.js';
import { noticeOf, storedMessage, type Notification } from '../src/notification/notification.js';

const to = 'owner@example.com';
const at = new Date('2026-11-04T15:30:00Z');
const dueAt = new Date('2027-01-03T15:30:00Z');

const notifications: Notification[] = noticeKinds.flatMap((kind): Notification[] => {
  if (kind === 'account_erased') return [];
  if (kind === 'new_sign_in') return [{ kind, device: { browser: 'firefox', os: 'linux' } }];
  if (kind === 'inactivity_warning') return [{ kind, dueAt }];
  return [{ kind }];
});

describe('stored notification messages (spec 0005, R7)', () => {
  it.each(notifications)('stores $kind as its code and words it back as the same notice', (n) => {
    const stored = storedMessage(n);
    expect(stored.code).toBe(n.kind);
    // Through JSON, as the jsonb column returns it.
    const read = { ...stored, details: JSON.parse(JSON.stringify(stored.details)) as unknown };
    expect(noticeOf(read, to, at)).toEqual({ ...n, to, at });
  });

  it('keeps only enum values and times in the details', () => {
    expect(notifications.map((n) => storedMessage(n).details)).toContainEqual({
      browser: 'firefox',
      os: 'linux',
    });
    expect(storedMessage({ kind: 'inactivity_warning', dueAt }).details).toEqual({
      dueAt: '2027-01-03T15:30:00.000Z',
    });
  });

  it.each([
    { code: 'account_erased', details: {} },
    { code: 'unknown_code', details: {} },
    { code: 'passkey_added', details: { name: 'Synthetic' } },
    { code: 'new_sign_in', details: { browser: 'firefox', os: 'linux', model: 'x' } },
    { code: 'new_sign_in', details: { browser: 'netscape', os: 'linux' } },
    { code: 'inactivity_warning', details: { dueAt: 'soon' } },
  ])('refuses $code with details outside its closed list', (message) => {
    expect(() => noticeOf(message, to, at)).toThrow();
  });
});
