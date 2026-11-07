import { grantAdminAction, routes } from '@arca/api-contract/client';
import type { Passkeys } from '@arca/platform';
import { api } from './api.js';
import { commonFailure, reach, type CommonFailure } from './requests.js';
import { stepUpFor } from './step-up.js';

/** Gives the admin role after an `admin_grant` step-up bound to the account (ADR-0027). */
export async function grantAdmin(passkeys: Passkeys, accountId: string): Promise<void> {
  const approved = await stepUpFor(passkeys, grantAdminAction({ accountId }), 'admin_grant');
  await reach(approved.call(routes.grantAdmin, { accountId }));
}

/** Takes the admin role away, with no step-up. */
export async function removeAdmin(accountId: string): Promise<void> {
  await reach(api.call(routes.removeAdmin, { accountId }));
}

export type AdminFailure = CommonFailure | 'not_found' | 'not_admin' | 'owner_list_admin';

export function adminFailure(error: unknown): AdminFailure {
  return commonFailure(error, ({ code }) =>
    code === 'not_found' || code === 'not_admin' || code === 'owner_list_admin' ? code : undefined,
  );
}
