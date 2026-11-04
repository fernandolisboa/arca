import { routes } from '@arca/api-contract/client';
import { NotificationsDeniedError, type Passkeys } from '@arca/platform';
import { api } from './api.js';
import { fromBase64url } from './base64url.js';
import { notifications } from './platform.js';
import { forgetPush, rememberThisDeviceChannel, thisDeviceChannel } from './push-device.js';
import { commonFailure, reach, type CommonFailure } from './requests.js';
import { stepUpFor } from './step-up.js';

/** Subscribes this browser with the environment's key and adds it as the account's channel. */
export async function enablePush(pushKey: string): Promise<void> {
  // A subscription this browser kept from another account must not be shared with this one.
  const subscription = await notifications.subscribe(fromBase64url(pushKey), {
    fresh: thisDeviceChannel() === undefined,
  });
  const { channelId } = await reach(api.call(routes.addPushChannel, subscription));
  rememberThisDeviceChannel(channelId);
}

/** Removing a channel needs a step-up bound to it, so a stolen session cannot silence one. */
export async function stopPush(passkeys: Passkeys, channelId: string): Promise<void> {
  const route = routes.removeNotificationChannel;
  const approved = await stepUpFor(passkeys, { action: route.operationId, targets: [channelId] });
  await reach(approved.call(route, { channelId }));
  if (channelId === thisDeviceChannel()) await forgetPush();
}

export type PushFailure = CommonFailure | 'denied' | 'too_many' | 'not_found';

export function pushFailure(error: unknown): PushFailure {
  if (error instanceof NotificationsDeniedError) return 'denied';
  return commonFailure(error, ({ code }) =>
    code === 'too_many_push_channels' ? 'too_many' : code === 'not_found' ? code : undefined,
  );
}
