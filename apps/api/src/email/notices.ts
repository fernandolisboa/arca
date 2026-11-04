import type { DeviceDescription } from '@arca/api-contract/routes';
import type { I18n } from '@arca/i18n';
import type { EmailMessage, EmailSender } from './email.js';

/** The security notices sent by email (spec 0003, R7); spec 0005 later adds every device. */
export const noticeKinds = [
  'passkey_added',
  'new_sign_in',
  'passkey_revoked',
  'pending_passkey_cancelled',
  'recovery_kit_regenerated',
  'recovery_started',
  'recovery_completed',
  'recovery_locked',
  'sessions_revoked',
] as const;
export type NoticeKind = (typeof noticeKinds)[number];

/** The new-sign-in notice names the device families, and nothing more about it. */
export type Notice =
  | {
      readonly kind: 'new_sign_in';
      readonly to: string;
      readonly at: Date;
      readonly device: DeviceDescription;
    }
  | { readonly kind: Exclude<NoticeKind, 'new_sign_in'>; readonly to: string; readonly at: Date };

const brasilia = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

/** Generic text and one link to the app; no personal data beyond the recipient (spec 0003, R8). */
export function noticeMessage(i18n: I18n, origin: string, notice: Notice): EmailMessage {
  const device =
    notice.kind === 'new_sign_in'
      ? {
          browser: i18n.t('device.browser', { browser: notice.device.browser }),
          os: i18n.t('device.os', { os: notice.device.os }),
        }
      : {};
  const body = i18n.t(`email.notice.${notice.kind}.body`, {
    when: brasilia.format(notice.at),
    ...device,
  });
  return {
    to: notice.to,
    subject: i18n.t(`email.notice.${notice.kind}.subject`),
    text: [body, i18n.t('email.link', { url: `${origin}/` }), i18n.t('email.signature')].join(
      '\n\n',
    ),
  };
}

export interface Notices {
  send(notice: Notice): Promise<void>;
}

export function createNotices({
  email,
  i18n,
  origin,
}: {
  readonly email: EmailSender;
  readonly i18n: I18n;
  readonly origin: string;
}): Notices {
  return { send: (notice) => email.send(noticeMessage(i18n, origin, notice)) };
}
