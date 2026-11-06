import { decideVersionAction, type DecideVersionRequest } from '@arca/api-contract/routes';
import { withIdentity, type Database } from '@arca/db';
import { sql } from 'drizzle-orm';
import { decision } from '@arca/db/knowledge-schema';
import {
  type CheckedDecision,
  type DecisionKind,
  type DecisionStates,
  type RouteCatalog,
  decisionStates,
  identityKey,
} from '@arca/domain';
import type { Logger } from '@arca/telemetry';
import type { AuditLog } from '../audit/log.js';
import type { SignedIn } from '../auth/service.js';
import type { StepUpSpender } from '../auth/step-up.js';
import { subjectHash, type CanonicalAction } from '../auth/step-up-encoding.js';
import { reverifyStepUp } from '../auth/step-up-reverify.js';

export type DecisionOutcome =
  | { readonly decided: string }
  | { readonly refused: 'not_approver' | 'not_found' | 'version_rejected' | 'step_up_required' };

export interface KnowledgeDecisions {
  readonly isApprover: (accountId: string) => boolean;
  /**
   * Activates or rejects one version (spec 0007, R7) with this session's `knowledge_decision`
   * step-up, bound to the version's hash in the bundled catalog and to the client's action nonce.
   */
  readonly decide: (
    signedIn: SignedIn,
    kind: DecisionKind,
    version: DecideVersionRequest,
    actionNonce: Uint8Array,
  ) => Promise<DecisionOutcome>;
  /** Every decided version's state, from the decisions that count; the engine's `states`. */
  readonly states: () => Promise<DecisionStates>;
}

export interface KnowledgeDecisionSettings {
  /** A database on the app_api pool. */
  readonly db: Database;
  readonly stepUp: StepUpSpender;
  readonly audit: AuditLog;
  readonly catalog: Pick<RouteCatalog, 'identities'>;
  readonly approvers: readonly string[];
  /** The environment's own origin; its host is the relying-party ID, as for every step-up. */
  readonly origin: string;
  readonly logger: Logger;
}

const actions = { activate: 'activateVersion', reject: 'rejectVersion' } as const;
const auditCodes = { activate: 'version_activated', reject: 'version_rejected' } as const;

type DecisionRow = typeof decision.$inferSelect;

/** The step-up action a decision approved, rebuilt from the decision's own fields. */
function decidedAction(
  row: Pick<DecisionRow, 'kind' | 'routeId' | 'versionNumber' | 'contentHash' | 'actionNonce'>,
): CanonicalAction {
  return {
    ...decideVersionAction(
      actions[row.kind as DecisionKind],
      { routeId: row.routeId, number: row.versionNumber },
      row.contentHash,
    ),
    nonce: row.actionNonce,
  };
}

export function createKnowledgeDecisions({
  db,
  stepUp,
  audit,
  catalog,
  approvers,
  origin,
  logger,
}: KnowledgeDecisionSettings): KnowledgeDecisions {
  const rpId = new URL(origin).hostname;
  const listed = new Set(approvers);
  // Decisions never change, and the list is fixed for the process, so neither does whether one counts.
  const counted = new Map<string, Promise<boolean>>();
  const assertionVerifies = (row: DecisionRow) =>
    reverifyStepUp(
      {
        credentialId: row.credentialId,
        nonce: row.serverNonce,
        authenticatorData: row.authenticatorData,
        clientDataJson: row.clientDataJson,
        signature: row.signature,
      },
      {
        purpose: 'knowledge_decision',
        subjectHash: subjectHash(decidedAction(row)),
        credentialId: row.credentialId,
        publicKey: new Uint8Array(row.publicKey),
        rpId,
        origin,
      },
    );

  const counts = async (row: DecisionRow) => {
    const valid = listed.has(row.approverAccountId) && (await assertionVerifies(row));
    if (!valid && row.kind === 'activate')
      logger.error({ errorName: 'KnowledgeActivationIgnored' });
    return valid;
  };

  const checked = async (row: DecisionRow): Promise<CheckedDecision> => {
    let check = counted.get(row.id);
    if (check === undefined) {
      check = counts(row);
      counted.set(row.id, check);
    }
    return {
      kind: row.kind as DecisionKind,
      identity: { routeId: row.routeId, number: row.versionNumber, hash: row.contentHash },
      verified: await check,
    };
  };

  const states = async () => {
    const rows = await db.select().from(decision).orderBy(decision.decidedAt, decision.id);
    return decisionStates(await Promise.all(rows.map(checked)));
  };

  return {
    isApprover: (accountId) => listed.has(accountId),

    decide: async (signedIn, kind, version, actionNonce) => {
      const { accountId } = signedIn;
      if (!listed.has(accountId)) return { refused: 'not_approver' };
      const identity = catalog
        .identities(version.routeId)
        .find(({ number }) => number === version.number);
      if (identity === undefined) return { refused: 'not_found' };
      if ((await states()).get(identityKey(identity)) === 'rejected') {
        return { refused: 'version_rejected' };
      }
      const action = {
        ...decideVersionAction(actions[kind], version, identity.hash),
        nonce: actionNonce,
      };
      // On app_auth, before anything is held on app_api.
      const spent = await stepUp.spend(signedIn, 'knowledge_decision', action);
      if (spent === undefined) return { refused: 'step_up_required' };
      // Spelled out, since app_api may not insert the ID or the time, not even as DEFAULT.
      const [stored] = (
        await withIdentity(db, { accountId }, (tx) =>
          tx.execute<{ id: string }>(sql`
            INSERT INTO knowledge.decision (kind, route_id, version_number, content_hash,
              approver_account_id, credential_id, public_key, action_nonce, server_nonce,
              authenticator_data, client_data_json, signature, step_up_id)
            VALUES (${kind}, ${identity.routeId}, ${identity.number}, ${identity.hash},
              ${accountId}, ${spent.credentialId}, ${Buffer.from(spent.publicKey)},
              ${Buffer.from(actionNonce)}, ${Buffer.from(spent.nonce)},
              ${Buffer.from(spent.authenticatorData)}, ${Buffer.from(spent.clientDataJson)},
              ${Buffer.from(spent.signature)}, ${spent.id})
            RETURNING id`),
        )
      ).rows;
      if (stored === undefined) throw new Error('the decision was not stored');
      await audit.record({
        code: auditCodes[kind],
        subjectAccountId: accountId,
        actorAccountId: accountId,
        details: { decisionId: stored.id, routeId: identity.routeId, number: identity.number },
      });
      return { decided: stored.id };
    },

    states,
  };
}
