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
 * revoked, so a shared browser never shows another account's notices. Its channel then answers
 * gone at the next notice and is deleted. A failure here never holds the sign-out back.
 */
export async function forgetPush(): Promise<void> {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // Nothing stored.
  }
  if (notificationsUnavailable !== undefined) return;
  await notifications.unsubscribe().catch(() => undefined);
}
