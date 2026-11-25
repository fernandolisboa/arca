import { routes, type SetChecklistMarkRequest } from '@arca/api-contract/client';
import type { Passkeys } from '@arca/platform';
import { api } from './api.js';
import { inVaultWindow } from './documents.js';
import { type CommonFailure, commonFailure, reach } from './requests.js';

/**
 * Sets or clears a checklist mark (spec #519). Linking a vault document needs this session's
 * `vault_unlock` window, which opens again with the passkey when it has ended.
 */
export async function setChecklistMark(passkeys: Passkeys, request: SetChecklistMarkRequest) {
  const send = () => api.call(routes.setChecklistMark, request);
  await (request.mark?.vaultDocumentId == null ? reach(send()) : inVaultWindow(passkeys, send));
}

export type MarkFailure = CommonFailure | 'not_found' | 'case_limit';

export function markFailure(error: unknown): MarkFailure {
  return commonFailure(error, ({ code }) =>
    code === 'not_found' || code === 'case_limit' ? code : undefined,
  );
}
