import {
  addCaseMemberAction,
  handOverCasePersonAction,
  leaveCaseAction,
  routes,
  type AddCaseMemberRequest,
  type CaseView,
  type RouteBody,
  type StepUpAction,
} from '@arca/api-contract/client';
import type { Passkeys } from '@arca/platform';
import { api } from './api.js';
import { commonFailure, reach, type CommonFailure } from './requests.js';
import { stepUpFor } from './step-up.js';

/** The family's case (spec 0007, R2 and R3): each write answers the case as the viewer now sees it. */
type CaseRoute =
  | typeof routes.createCase
  | typeof routes.addCasePerson
  | typeof routes.updateCasePerson
  | typeof routes.removeCasePerson
  | typeof routes.replaceCaseShares
  | typeof routes.addCaseRelationship
  | typeof routes.removeCaseRelationship
  | typeof routes.handOverCasePerson
  | typeof routes.addCaseMember;

/** A write, after a `sensitive_settings` step-up when it names one. */
export async function writeCase<Route extends CaseRoute>(
  passkeys: Passkeys,
  route: Route,
  body: RouteBody<Route>,
  action?: Omit<StepUpAction, 'nonce'>,
): Promise<CaseView | null> {
  const client = action === undefined ? api : await stepUpFor(passkeys, action);
  const call = client.call.bind(client) as (
    route: CaseRoute,
    body: unknown,
  ) => Promise<{ case: CaseView | null }>;
  return (await reach(call(route, body))).case;
}

/** Adds an account the viewer confirmed; taking over a person needs the step-up for both. */
export const addToCase = (passkeys: Passkeys, request: AddCaseMemberRequest) =>
  writeCase(passkeys, routes.addCaseMember, request, addCaseMemberAction(request));

export const handOver = (passkeys: Passkeys, personId: string, accountId: string) =>
  writeCase(
    passkeys,
    routes.handOverCasePerson,
    { personId, accountId },
    handOverCasePersonAction({ personId, accountId }),
  );

/** Leaves the case after a step-up; every person the viewer keeps goes with them. */
export async function leaveCase(passkeys: Passkeys): Promise<void> {
  const approved = await stepUpFor(passkeys, leaveCaseAction);
  await reach(approved.call(routes.leaveCase, {}));
}

export type CaseFailure =
  CommonFailure | 'not_found' | 'case_exists' | 'case_limit' | 'case_invalid';

export function caseFailure(error: unknown): CaseFailure {
  return commonFailure(error, ({ code }) =>
    code === 'not_found' ||
    code === 'case_exists' ||
    code === 'case_limit' ||
    code === 'case_invalid'
      ? code
      : undefined,
  );
}
