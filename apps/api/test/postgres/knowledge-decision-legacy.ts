import { randomBytes } from 'node:crypto';
import { decideVersionAction, type StepUpOptionsRequest } from '@arca/api-contract/routes';
import { comparisonSeriesId, type VersionIdentity } from '@arca/domain';
import { expect } from 'vitest';
import type { StepUpService } from '../../src/auth/step-up.js';
import type { CanonicalAction } from '../../src/auth/step-up-encoding.js';
import type { AuthTestDatabase } from './auth-database.js';
import { ceremony, type Person, toRequest } from './step-up-people.js';

// Decisions as ADR-0022 stored them, approved by a `knowledge_decision` step-up, which the
// options route no longer offers (ADR-0027). Synthetic data only.

export const comparisonTarget = {
  subject: 'comparison',
  comparisonId: comparisonSeriesId,
  number: 1,
} as const;

/** The step-up action an ADR-0022 decision on the route version was approved with. */
export const routeAction = (
  kind: 'activate' | 'reject',
  { routeId, number, hash }: Pick<VersionIdentity, 'routeId' | 'number' | 'hash'>,
): CanonicalAction => ({
  ...decideVersionAction(
    kind === 'activate' ? 'activateVersion' : 'rejectVersion',
    { routeId, number },
    hash,
  ),
  nonce: randomBytes(16),
});

/**
 * Options and verify for a `knowledge_decision` step-up, as the options route offered it before
 * ADR-0027; the service itself still issues any purpose the database accepts.
 */
export async function legacyStepUp(stepUp: StepUpService, who: Person, action: CanonicalAction) {
  const request = {
    ...toRequest('sensitive_settings', action),
    purpose: 'knowledge_decision',
  } as unknown as StepUpOptionsRequest;
  const { verified } = await ceremony(stepUp, who, request);
  expect(verified).toBe(true);
}

/**
 * An ADR-0022 route decision: a real step-up, spent, then copied into a `step_up` row by the
 * server's admin, since no runtime role may store one any more. `changes` overrides copied fields.
 */
export async function legacyDecision(
  testDatabase: AuthTestDatabase,
  stepUp: StepUpService,
  who: Person,
  action: CanonicalAction,
  changes: { readonly signature?: Uint8Array } = {},
) {
  await legacyStepUp(stepUp, who, action);
  expect(await stepUp.consume(who.signedIn, 'knowledge_decision', action)).toBe(true);
  const [routeId = '', number = '1'] = action.targets;
  const kind = action.action === 'activateVersion' ? 'activate' : 'reject';
  await testDatabase.asAdmin((client) =>
    client.query(
      `INSERT INTO knowledge.decision (kind, subject_kind, route_id, version_number, content_hash,
         approver_account_id, proof, credential_id, public_key, action_nonce, server_nonce,
         authenticator_data, client_data_json, signature, step_up_id)
       SELECT $1, 'route', $2, $3, $4, account_id, 'step_up', credential_id, $5, $6, nonce,
         authenticator_data, client_data_json, coalesce($7, signature), id
         FROM auth.step_up WHERE account_id = $8 AND consumed_at IS NOT NULL
        ORDER BY consumed_at DESC LIMIT 1`,
      [
        kind,
        routeId,
        Number(number),
        action.fields?.['contentHash'],
        Buffer.from(who.passkey.publicKey, 'base64'),
        Buffer.from(action.nonce),
        changes.signature === undefined ? null : Buffer.from(changes.signature),
        who.signedIn.accountId,
      ],
    ),
  );
}
