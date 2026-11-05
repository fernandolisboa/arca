import type { Capabilities } from '../capabilities.js';
import type { Notifications } from '../notifications.js';
import { check, rejectsWith, type ConformanceCase } from './check.js';

export interface NotificationsHarness {
  readonly capabilities: Capabilities;
  readonly notifications: Notifications;
  /** The answer the person gives the next permission prompt. */
  readonly answerPrompt: (answer: 'granted' | 'denied') => Promise<void>;
  /** Whether a push service is reachable, so a granted subscription can complete. */
  readonly pushService: boolean;
}

/** A synthetic P-256 public key, as an uncompressed point is laid out. */
const applicationServerKey = new Uint8Array(65).map((_, index) => (index === 0 ? 4 : index));

export function notificationsConformance(harness: NotificationsHarness): ConformanceCase[] {
  const { capabilities, notifications, answerPrompt, pushService } = harness;
  if (!capabilities.has('notifications')) {
    return [
      {
        name: 'refuses every call while unavailable',
        run: async () => {
          await rejectsWith(() => notifications.permission(), 'CapabilityUnavailableError');
          await rejectsWith(
            () => notifications.subscribe(applicationServerKey),
            'CapabilityUnavailableError',
          );
          await rejectsWith(() => notifications.unsubscribe(), 'CapabilityUnavailableError');
        },
      },
    ];
  }
  const cases: ConformanceCase[] = [
    {
      name: 'reports the permission',
      run: async () => {
        const permission = await notifications.permission();
        check(['granted', 'denied', 'prompt'].includes(permission), `unknown ${permission}`);
      },
    },
    {
      name: 'refuses to subscribe when the person says no',
      run: async () => {
        await answerPrompt('denied');
        await rejectsWith(
          () => notifications.subscribe(applicationServerKey),
          'NotificationsDeniedError',
        );
      },
    },
    {
      name: 'unsubscribes when there is no subscription',
      run: async () => {
        check((await notifications.unsubscribe()) === undefined, 'a subscription was reported');
      },
    },
  ];
  if (pushService) {
    cases.push({
      name: 'subscribes with an https endpoint and both keys',
      run: async () => {
        await answerPrompt('granted');
        const channel = await notifications.subscribe(applicationServerKey);
        check(new URL(channel.endpoint).protocol === 'https:', 'the endpoint is not https');
        check(channel.p256dh.length > 0 && channel.auth.length > 0, 'a key is missing');
        const ended = await notifications.unsubscribe();
        check(
          ended?.endpoint === channel.endpoint && ended.auth === channel.auth,
          'the ended subscription is not the one made',
        );
      },
    });
  }
  return cases;
}
