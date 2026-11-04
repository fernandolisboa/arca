import { guarded, requireCapability, type Capabilities } from './capabilities.js';
import {
  NotificationsDeniedError,
  type NotificationPermission,
  type Notifications,
} from './notifications.js';

const permissions: Record<globalThis.NotificationPermission, NotificationPermission> = {
  default: 'prompt',
  denied: 'denied',
  granted: 'granted',
};

const workerWaitMs = 10_000;

/** The app's service worker, or a failure: `ready` never settles where none registered. */
async function workerReady(scope: typeof globalThis): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('no service worker is active'));
    }, workerWaitMs);
  });
  try {
    return await Promise.race([scope.navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function sameKey(current: ArrayBuffer | null, wanted: Uint8Array): boolean {
  if (current?.byteLength !== wanted.length) return false;
  const bytes = new Uint8Array(current);
  return bytes.every((byte, index) => byte === wanted[index]);
}

/** Web push through the app's service worker (spec 0005, R7). */
export function createWebNotifications(
  capabilities: Capabilities,
  scope: typeof globalThis = globalThis,
): Notifications {
  return {
    permission: guarded(
      capabilities,
      'notifications',
      () => permissions[scope.Notification.permission],
    ),
    async subscribe(applicationServerKey) {
      requireCapability(capabilities, 'notifications');
      if ((await scope.Notification.requestPermission()) !== 'granted') {
        throw new NotificationsDeniedError('notifications were not allowed');
      }
      const registration = await workerReady(scope);
      // A subscription made for another key (a rotated one) would make subscribe throw.
      const existing = await registration.pushManager.getSubscription();
      if (
        existing !== null &&
        !sameKey(existing.options.applicationServerKey, applicationServerKey)
      ) {
        await existing.unsubscribe();
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: new Uint8Array(applicationServerKey),
      });
      const { endpoint, keys } = subscription.toJSON();
      const p256dh = keys?.['p256dh'];
      const auth = keys?.['auth'];
      if (endpoint === undefined || p256dh === undefined || auth === undefined) {
        throw new Error('the push subscription has no endpoint or keys');
      }
      return { endpoint, p256dh, auth };
    },
    async unsubscribe() {
      requireCapability(capabilities, 'notifications');
      const registration = await scope.navigator.serviceWorker.getRegistration();
      await (await registration?.pushManager.getSubscription())?.unsubscribe();
    },
  };
}
