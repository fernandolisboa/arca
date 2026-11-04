export type NotificationPermission = 'granted' | 'denied' | 'prompt';

/** What the API stores for a web push channel (spec 0005, R7). Keys are base64url. */
export interface PushChannel {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/** The person refused notifications, or the browser refused on their behalf. */
export class NotificationsDeniedError extends Error {
  override name = 'NotificationsDeniedError';
}

/** Push notifications for this device. Subscribing must start from a user gesture. */
export interface Notifications {
  permission(): Promise<NotificationPermission>;
  /**
   * Asks for permission if needed, then subscribes with the environment's VAPID public key.
   * `fresh` drops a subscription this device already holds, so the new one shares nothing with it.
   */
  subscribe(
    applicationServerKey: Uint8Array,
    options?: { readonly fresh?: boolean },
  ): Promise<PushChannel>;
  /** Ends this device's subscription, if any. */
  unsubscribe(): Promise<void>;
}
