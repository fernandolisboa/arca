import {
  addCaseMemberAction,
  routes,
  type AddCaseMemberRequest,
  type CaseView,
} from '@arca/api-contract/client';
import type { Passkeys } from '@arca/platform';
import { api } from './api.js';
import { commonFailure, reach, type CommonFailure } from './requests.js';
import { stepUpFor } from './step-up.js';

/**
 * Adds an account the viewer confirmed to their case (spec 0007, R2); taking over a person the
 * viewer keeps needs a step-up bound to that person and the account.
 */
export async function addToCase(
  passkeys: Passkeys,
  request: AddCaseMemberRequest,
): Promise<CaseView | null> {
  const action = addCaseMemberAction(request);
  const client = action === undefined ? api : await stepUpFor(passkeys, action);
  return (await reach(client.call(routes.addCaseMember, request))).case;
}

export type AddFailure = CommonFailure | 'not_found' | 'case_exists' | 'case_limit';

export function addFailure(error: unknown): AddFailure {
  return commonFailure(error, ({ code }) =>
    code === 'not_found' || code === 'case_exists' || code === 'case_limit' ? code : undefined,
  );
}
