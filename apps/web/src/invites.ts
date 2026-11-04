import { routes, type InviteDetails } from '@arca/api-contract/client';
import type { Passkeys } from '@arca/platform';
import { api } from './api.js';
import { registrationFailure } from './enrollment.js';
import { commonFailure, reach, type CommonFailure } from './requests.js';
import { stepUpFor } from './step-up.js';

/** Who sent a link that can still be accepted; null when it cannot. */
export async function inviteFrom(token: string): Promise<InviteDetails | null> {
  try {
    return await reach(api.call(routes.inviteDetails, { token }));
  } catch (error) {
    if (
      commonFailure(error, ({ code }) => (code === 'not_found' ? code : undefined)) === 'not_found'
    ) {
      return null;
    }
    throw error;
  }
}

export type AcceptFailure = Exclude<ReturnType<typeof registrationFailure>, 'invalid_code'>;

/** An invite's registration has no code, so a wrong code never comes back. */
export function acceptFailure(error: unknown): AcceptFailure {
  const failure = registrationFailure(error);
  return failure === 'invalid_code' ? 'other' : failure;
}

export async function sendInvite(email: string): Promise<void> {
  await reach(api.call(routes.createInvite, { email }));
}

export type SendFailure =
  CommonFailure | 'account_unconfirmed' | 'too_many_invites' | 'email_unavailable';

export function sendFailure(error: unknown): SendFailure {
  return commonFailure(error, ({ code }) =>
    code === 'account_unconfirmed' || code === 'too_many_invites' || code === 'email_unavailable'
      ? code
      : undefined,
  );
}

export type Decision = 'confirm' | 'decline';

const decisionRoutes = { confirm: routes.confirmInvite, decline: routes.declineInvite } as const;

/** Confirms or declines an accepted invite's account, after a step-up bound to that invite. */
export async function decideInvite(
  passkeys: Passkeys,
  decision: Decision,
  inviteId: string,
): Promise<void> {
  const route = decisionRoutes[decision];
  const approved = await stepUpFor(passkeys, { action: route.operationId, targets: [inviteId] });
  await reach(approved.call(route, { inviteId }));
}

export type DecisionFailure = CommonFailure | 'not_found';

export function decisionFailure(error: unknown): DecisionFailure {
  return commonFailure(error, ({ code }) => (code === 'not_found' ? code : undefined));
}
