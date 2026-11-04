import type { Notification } from '../src/notification/notification.js';
import type { Notifier } from '../src/notification/notifier.js';

export type Notified = Notification & { readonly accountId: string };

/** A notifier that keeps what it was given, or refuses while `failing` is set. */
export function recordingNotifier() {
  const recorder = {
    sent: [] as Notified[],
    failing: false,
    /** The kinds the account was notified of, in order. */
    to: (accountId: string) =>
      recorder.sent.filter((notified) => notified.accountId === accountId).map(({ kind }) => kind),
    notifier: {
      notify: (accountId, notification) => {
        if (recorder.failing) return Promise.reject(new Error('notifications unavailable'));
        recorder.sent.push({ accountId, ...notification });
        return Promise.resolve();
      },
    } satisfies Notifier,
  };
  return recorder;
}

/** A notifier that accepts and forgets everything. */
export const quietNotifier: Notifier = { notify: () => Promise.resolve() };
