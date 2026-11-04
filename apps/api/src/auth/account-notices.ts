import type { Database } from '@arca/db';
import type { NoticeKind, Notices } from '../email/notices.js';
import type { Logger } from '../logger.js';
import { accounts } from './auth.js';

/** Each module names the notices it sends, so the type says which module sends what. */
export type AccountNotice<Kind extends Exclude<NoticeKind, 'new_sign_in'>> = (
  accountId: string,
  kind: Kind,
) => Promise<void>;

/**
 * Sends a security notice to the account's address. A notice that fails to send never undoes the
 * change it reports; the failure is logged under `label`, with no personal data.
 */
export function accountNotice<Kind extends Exclude<NoticeKind, 'new_sign_in'>>({
  db,
  notices,
  logger,
  label,
  clock = () => new Date(),
}: {
  readonly db: Database;
  readonly notices: Notices;
  readonly logger: Logger;
  readonly label: string;
  readonly clock?: () => Date;
}): AccountNotice<Kind> {
  return async (accountId, kind) => {
    try {
      const to = await accounts.emailOf(db, accountId);
      if (to !== undefined) await notices.send({ kind, to, at: clock() });
    } catch (error) {
      logger.error({
        errorName: `${label}:${error instanceof Error ? error.name : 'NonErrorThrown'}`,
      });
    }
  };
}
