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

const adminCodes = ['not_found', 'not_admin', 'owner_list_admin', 'step_up_required'] as const;

export type AdminFailure = CommonFailure | (typeof adminCodes)[number];

export function adminFailure(error: unknown): AdminFailure {
  return commonFailure(error, ({ code }) => adminCodes.find((known) => known === code));
}
