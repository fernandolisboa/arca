import { DeviceDescription } from '@arca/api-contract/routes';
import { z } from 'zod';
import { noticeKinds, type Notice, type PlainNoticeKind } from '../email/notices.js';

/**
 * What an account is told (spec 0005, R7). Every security notice but the erasure notice, which
 * spec 0004 R9 sends by email directly because the account's channels are already erased.
 */
export type Notification =
  | { readonly kind: 'new_sign_in'; readonly device: DeviceDescription }
  | { readonly kind: 'inactivity_warning'; readonly dueAt: Date }
  | { readonly kind: PlainNotificationKind };

export type PlainNotificationKind = Exclude<PlainNoticeKind, 'account_erased'>;

/** A `notification.message` row's code and details: enum values and times only. */
export interface StoredMessage {
  readonly code: string;
  readonly details: unknown;
}

export function storedMessage(notification: Notification): StoredMessage {
  switch (notification.kind) {
    case 'new_sign_in':
      return { code: notification.kind, details: notification.device };
    case 'inactivity_warning':
      return { code: notification.kind, details: { dueAt: notification.dueAt.toISOString() } };
    default:
      return { code: notification.kind, details: {} };
  }
}

const plainKinds = noticeKinds.filter(
  (kind): kind is PlainNotificationKind =>
    kind !== 'account_erased' && kind !== 'new_sign_in' && kind !== 'inactivity_warning',
);

/** The closed list of details per code; a row outside it is refused, never sent. */
const Stored = z.discriminatedUnion('code', [
  z.object({ code: z.literal('new_sign_in'), details: DeviceDescription.strict() }),
  z.object({
    code: z.literal('inactivity_warning'),
    details: z.strictObject({ dueAt: z.iso.datetime() }),
  }),
  z.object({ code: z.enum(plainKinds), details: z.strictObject({}) }),
]);

/** The stored message's code, once its details pass the closed list. */
export function checkedCode(message: StoredMessage): Notification['kind'] {
  return Stored.parse(message).code;
}

/** The notice a stored message words for `to`, at the time it was created. */
export function noticeOf(message: StoredMessage, to: string, at: Date): Notice {
  const parsed = Stored.parse(message);
  switch (parsed.code) {
    case 'new_sign_in':
      return { kind: parsed.code, to, at, device: parsed.details };
    case 'inactivity_warning':
      return { kind: parsed.code, to, at, dueAt: new Date(parsed.details.dueAt) };
    default:
      return { kind: parsed.code, to, at };
  }
}
