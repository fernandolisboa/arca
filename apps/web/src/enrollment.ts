import { ApiError, routes } from '@arca/api-contract/client';
import type { Passkeys } from '@arca/platform';
import { api } from './api.js';
import { toAttestation, toCreationOptions } from './passkey-json.js';
import { commonFailure, reach, type CommonFailure } from './requests.js';
import { stepUpFor } from './step-up.js';

const linkTokenPattern = /^[A-Za-z0-9_-]{43}$/;

/** The registration token of an emailed link, from its fragment, which never reaches a server. */
export function linkTokenFrom(hash: string): string | undefined {
  const token = hash.slice(1);
  return linkTokenPattern.test(token) ? token : undefined;
}

/** Takes the token out of the address bar and the history entry (spec 0003, R2). */
export function clearFragment(location: Location, history: History): void {
  if (location.hash !== '') {
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  }
}

export type LinkRequestFailure = CommonFailure | 'not_found' | 'email_unavailable';

/** The owner's request for the first account's link. */
export async function requestOwnerLink(code: string, email: string): Promise<void> {
  await reach(api.call(routes.enrollOwner, { code, email }));
}

export function linkRequestFailure(error: unknown): LinkRequestFailure {
  return commonFailure(error, ({ code }) =>
    code === 'not_found' || code === 'email_unavailable' ? code : undefined,
  );
}

export type RegistrationFailure =
  CommonFailure | 'expired' | 'invalid_code' | 'refused' | 'signed_in';

/**
 * Passkey-first registration from a link (spec 0003, R2 and R3): an owner's code is checked with
 * the options, before the device creates anything; a successful verify signs the new account in.
 */
export async function registerFromLink(
  passkeys: Passkeys,
  { token, code }: { readonly token: string; readonly code?: string },
): Promise<void> {
  // An invite's link carries no code; an owner's needs it.
  const typed = code === undefined ? {} : { code };
  const options = await reach(api.call(routes.registrationOptions, { token, ...typed }));
  const response = await passkeys.create(toCreationOptions(options));
  await reach(
    api.call(routes.registrationVerify, { token, ...typed, response: toAttestation(response) }),
  );
}

export function registrationFailure(error: unknown): RegistrationFailure {
  return commonFailure(error, ({ code }) => {
    if (code === 'not_found') return 'expired';
    if (code === 'invalid_code' || code === 'signed_in') return code;
    return code === 'registration_refused' ? 'refused' : undefined;
  });
}

/** The account's first kit, or a new one after a step-up when the account already has one. */
export async function newRecoveryCode(
  passkeys: Passkeys,
  { replace }: { readonly replace: boolean },
): Promise<string> {
  if (!replace) {
    try {
      return (await reach(api.call(routes.regenerateRecoveryKit, {}))).code;
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'step_up_required')) throw error;
    }
  }
  const approved = await stepUpFor(passkeys, { action: 'regenerateRecoveryKit', targets: [] });
  return (await reach(approved.call(routes.regenerateRecoveryKit, {}))).code;
}

/** Groups of four symbols, easier to copy by hand. */
export function groupCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1 ');
}
