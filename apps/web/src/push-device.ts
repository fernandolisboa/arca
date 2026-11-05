import { routes } from '@arca/api-contract/client';
import { api } from './api.js';
import { notifications, notificationsUnavailable } from './platform.js';

/** Which listed channel is this browser's: the list never carries endpoints (spec 0005, R7). */
const storageKey = 'arca.push-channel';

export function thisDeviceChannel(): string | undefined {
  try {
    return localStorage.getItem(storageKey) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberThisDeviceChannel(channelId: string): void {
  try {
    localStorage.setItem(storageKey, channelId);
  } catch {
    // Without storage the list only loses its "this device" label.
  }
}

/**
 * Ends this browser's push subscription on sign-out, an account change and a session found
 * revoked, so a shared browser never shows another account's notices. While the session still
 * holds, its channel is removed with the subscription's secret; otherwise the channel answers
 * gone at the next notice and is deleted then. A failure here never holds the sign-out back.
 */
export async function forgetPush(): Promise<void> {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // Nothing stored.
  }
  if (notificationsUnavailable !== undefined) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A stalled push service or network must not hold a sign-out on a shared computer.
  const giveUp = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, forgetWaitMs);
  });
  try {
    await Promise.race([endSubscription().catch(() => undefined), giveUp]);
  } finally {
    clearTimeout(timer);
  }
}

const forgetWaitMs = 3_000;

async function endSubscription(): Promise<void> {
  const ended = await notifications.unsubscribe();
  if (ended === undefined) return;
  await api.call(routes.forgetPushChannel, { endpoint: ended.endpoint, auth: ended.auth });
}
