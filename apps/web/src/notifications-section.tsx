import { maxPushChannels, type NotificationChannel } from '@arca/api-contract/client';
import { Button } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { notificationChannelsQuery, sessionQuery } from './api.js';
import { dangerLinkClass } from './forms/text-link.js';
import { notifications, notificationsUnavailable, passkeys } from './platform.js';
import { enablePush, pushFailure, stopPush, type PushFailure } from './push.js';
import { thisDeviceChannel } from './push-device.js';
import { useDateFormat } from './use-date-format.js';

type Done = 'enabled' | 'removed';
type Unavailable = 'install' | 'unsupported' | 'not_set_up' | 'denied';

/** Why this browser cannot turn push on, or nothing when it can. */
function useUnavailable(pushKey: string | null | undefined): Unavailable | undefined {
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    if (notificationsUnavailable !== undefined) return;
    void notifications
      .permission()
      .then((permission) => {
        setDenied(permission === 'denied');
      })
      .catch(() => undefined);
  }, []);
  if (notificationsUnavailable === 'needs-install') return 'install';
  if (notificationsUnavailable !== undefined) return 'unsupported';
  if (pushKey === null) return 'not_set_up';
  return denied ? 'denied' : undefined;
}

/** "Avisos de segurança" in the settings: the account's channels and this device's push. */
export function NotificationsSection() {
  const { t } = useTranslation();
  const session = useQuery(sessionQuery);
  const restricted =
    session.isSuccess && (session.data.recoveryPending || session.data.deletionDueAt !== null);
  const channels = useQuery({
    ...notificationChannelsQuery,
    enabled: session.isSuccess && !restricted,
  });
  const queryClient = useQueryClient();
  const [waiting, setWaiting] = useState<'enabling' | 'waiting'>();
  const [outcome, setOutcome] = useState<{ done: Done } | { failure: PushFailure }>();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const unavailable = useUnavailable(channels.data?.pushKey);
  if (!session.isSuccess || restricted) return null;

  const change = (kind: 'enabling' | 'waiting', run: () => Promise<void>, done: Done) => {
    setOutcome(undefined);
    setWaiting(kind);
    run()
      .then(async () => {
        setOutcome({ done });
        await queryClient.invalidateQueries({ queryKey: notificationChannelsQuery.queryKey });
      })
      .catch((error: unknown) => {
        setOutcome({ failure: pushFailure(error) });
      })
      .finally(() => {
        setWaiting(undefined);
        // The control that had focus may leave with its row, so focus moves to the result.
        statusRef.current?.focus();
      });
  };

  const mine = thisDeviceChannel();
  const pushChannels = channels.data?.channels.filter(({ kind }) => kind === 'web_push') ?? [];
  const subscribedHere = pushChannels.some(({ id }) => id === mine);
  const pushKey = channels.data?.pushKey ?? null;
  const message =
    waiting !== undefined
      ? t(`settings.notifications.${waiting}`)
      : outcome === undefined
        ? ''
        : 'done' in outcome
          ? t('settings.notifications.done', { done: outcome.done })
          : t('settings.notifications.failure', { reason: outcome.failure, max: maxPushChannels });

  return (
    <section aria-labelledby="notifications-title" className="flex flex-col items-start gap-3">
      <h3 id="notifications-title" className="text-title font-medium">
        {t('settings.notifications.title')}
      </h3>
      <p className="text-muted">{t('settings.notifications.intro')}</p>
      {channels.isError && <p className="text-ink">{t('settings.notifications.listFailure')}</p>}
      {channels.isSuccess && (
        <ul aria-label={t('settings.notifications.title')} className="flex w-full flex-col gap-3">
          <li className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4">
            <p className="font-medium">{t('settings.notifications.email')}</p>
            <p className="text-small text-muted">{t('settings.notifications.emailNote')}</p>
          </li>
          {pushChannels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              here={channel.id === mine}
              disabled={waiting !== undefined}
              onStop={() => {
                change('waiting', () => stopPush(passkeys, channel.id), 'removed');
              }}
            />
          ))}
        </ul>
      )}
      {channels.isSuccess &&
        !subscribedHere &&
        (unavailable === undefined && pushKey !== null ? (
          <Button
            disabled={waiting !== undefined}
            aria-busy={waiting === 'enabling'}
            onClick={() => {
              change('enabling', () => enablePush(pushKey), 'enabled');
            }}
          >
            {t('settings.notifications.enable')}
          </Button>
        ) : (
          <p className="text-muted">
            {t('settings.notifications.unavailable', { reason: unavailable ?? 'not_set_up' })}
          </p>
        ))}
      <p
        ref={statusRef}
        role="status"
        tabIndex={-1}
        className={outcome !== undefined && 'done' in outcome ? 'text-ok-ink' : 'text-ink'}
      >
        {message}
      </p>
    </section>
  );
}

function ChannelRow({
  channel,
  here,
  disabled,
  onStop,
}: {
  readonly channel: NotificationChannel;
  readonly here: boolean;
  readonly disabled: boolean;
  readonly onStop: () => void;
}) {
  const { t } = useTranslation();
  const when = useDateFormat();
  return (
    <li className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4">
      <p className="font-medium">
        {t('settings.notifications.device', {
          browser: t('device.browser', { browser: channel.browser ?? 'other' }),
          os: t('device.os', { os: channel.os ?? 'other' }),
        })}
      </p>
      {here && <p className="text-small text-muted">{t('settings.notifications.thisDevice')}</p>}
      <p className="text-small text-muted">
        {channel.lastSuccessAt === null
          ? t('settings.notifications.noneYet')
          : t('settings.notifications.lastSuccess', {
              date: when.format(new Date(channel.lastSuccessAt)),
            })}
      </p>
      <button
        type="button"
        disabled={disabled}
        className={`${dangerLinkClass} self-start`}
        onClick={onStop}
      >
        {t('settings.notifications.remove')}
      </button>
    </li>
  );
}
