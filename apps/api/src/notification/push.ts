import { isPushServiceEndpoint } from '@arca/api-contract/routes';
import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { VapidKeys } from './vapid.js';

/** A stored `web_push` channel's subscription; keys base64url. */
export interface PushSubscriptionKeys {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly authSecret: string;
}

/** The whole payload: no text, which the service worker words from the code (spec 0005, R7). */
export interface PushPayload {
  readonly code: string;
  readonly id: string;
}

/**
 * `gone`: the push service will never take this subscription again (it expired, belongs to a
 * rotated VAPID key, or is malformed), so its channel goes.
 */
export type PushOutcome = 'delivered' | 'gone';

export interface PushSender {
  send(subscription: PushSubscriptionKeys, payload: PushPayload): Promise<PushOutcome>;
}

/** The push service refused for a reason that may pass, such as load; retried by the step. */
export class PushRejectedError extends Error {
  override name = 'PushRejectedError';
  readonly status: number;
  constructor(status: number) {
    super(`push service answered ${String(status)}`);
    this.status = status;
  }
}

const sendTimeoutMs = 10_000;

/** Bad request, unauthorized for this key, forbidden, unknown, expired. */
const permanentRefusals = new Set([400, 401, 403, 404, 410]);

/** How long a push service keeps a notice for a device that is offline. */
const timeToLiveSeconds = 24 * 60 * 60;

/**
 * Sends with the environment's VAPID keys through `@block65/webcrypto-web-push` (RFC 8291's
 * aes128gcm, padded to the full record, and RFC 8292). Only the known push services are reached,
 * without following redirects.
 */
export function vapidPushSender({
  keys,
  contact,
  fetch = globalThis.fetch,
}: {
  readonly keys: VapidKeys;
  /** The VAPID subject: the environment's own origin, never a person's address. */
  readonly contact: string;
  readonly fetch?: typeof globalThis.fetch;
}): PushSender {
  return {
    async send({ endpoint, p256dh, authSecret }, payload) {
      if (!isPushServiceEndpoint(endpoint)) return 'gone';
      const request = await buildPushPayload(
        {
          data: { code: payload.code, id: payload.id },
          options: { ttl: timeToLiveSeconds, urgency: 'high' },
        },
        { endpoint, expirationTime: null, keys: { p256dh, auth: authSecret } },
        { subject: contact, publicKey: keys.publicKey, privateKey: keys.privateKey },
      );
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        redirect: 'error',
        signal: AbortSignal.timeout(sendTimeoutMs),
      });
      await response.body?.cancel();
      if (permanentRefusals.has(response.status)) return 'gone';
      if (response.status >= 200 && response.status < 300) return 'delivered';
      throw new PushRejectedError(response.status);
    },
  };
}
