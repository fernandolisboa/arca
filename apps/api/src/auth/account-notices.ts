import type { Logger } from '@arca/telemetry';
import type { PlainNotificationKind } from '../notification/notification.js';
import type { Notifier } from '../notification/notifier.js';

/** Each module names the notices it sends, so the type says which module sends what. */
export type AccountNotice<Kind extends PlainNotificationKind> = (
  accountId: string,
  kind: Kind,
) => Promise<void>;

/**
 * Notifies the account of a security change. A notice that fails never undoes the change it
 * reports; the failure is logged under `label`, with no personal data.
 */
export function accountNotice<Kind extends PlainNotificationKind>({
  notifier,
  logger,
  label,
}: {
  readonly notifier: Notifier;
  readonly logger: Logger;
  readonly label: string;
}): AccountNotice<Kind> {
  return async (accountId, kind) => {
    try {
      await notifier.notify(accountId, { kind });
    } catch (error) {
      logger.error({
        errorName: `${label}:${error instanceof Error ? error.name : 'NonErrorThrown'}`,
      });
    }
  };
}
