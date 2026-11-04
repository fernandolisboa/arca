import { routes } from '@arca/api-contract/client';
import type { Passkeys } from '@arca/platform';
import { api } from './api.js';
import { toAttestation, toCreationOptions } from './passkey-json.js';
import { commonFailure, reach, type CommonFailure } from './requests.js';
import { stepUpFor } from './step-up.js';

/** Each change on the device list is bound by a step-up to its own action and target (R4). */
export async function revokeSession(passkeys: Passkeys, sessionId: string): Promise<void> {
  const route = routes.revokeSession;
  const approved = await stepUpFor(passkeys, { action: route.operationId, targets: [sessionId] });
  await reach(approved.call(route, { sessionId }));
}

/** Removes an active passkey, or cancels a pending one. */
export async function revokePasskey(passkeys: Passkeys, passkeyId: string): Promise<void> {
  const route = routes.revokePasskey;
  const approved = await stepUpFor(passkeys, { action: route.operationId, targets: [passkeyId] });
  await reach(approved.call(route, { passkeyId }));
}

export async function revokeOtherSessions(passkeys: Passkeys): Promise<void> {
  const route = routes.revokeOtherSessions;
  const approved = await stepUpFor(passkeys, { action: route.operationId, targets: [] });
  await reach(approved.call(route, {}));
}

/** A step-up with an existing passkey, then the new one; it waits 24 hours before it works. */
export async function addPasskey(passkeys: Passkeys): Promise<void> {
  const approved = await stepUpFor(passkeys, {
    action: routes.addPasskeyOptions.operationId,
    targets: [],
  });
  const { challengeId, options } = await reach(approved.call(routes.addPasskeyOptions, {}));
  const response = await passkeys.create(toCreationOptions(options));
  await reach(api.call(routes.addPasskey, { challengeId, response: toAttestation(response) }));
}

export type DeviceFailure = CommonFailure | 'not_found' | 'last_active' | 'refused';

export function deviceFailure(error: unknown): DeviceFailure {
  return commonFailure(error, ({ code }) => {
    if (code === 'not_found') return code;
    if (code === 'last_active_passkey') return 'last_active';
    return code === 'passkey_refused' ? 'refused' : undefined;
  });
}
