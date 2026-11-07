import { randomUUID } from 'node:crypto';
import {
  type DecideComparisonRequest,
  type DecideVersionRequest,
  decideComparisonAction,
  decideVersionAction,
} from '@arca/api-contract/routes';
import type { Database } from '@arca/db';
import { decision } from '@arca/db/knowledge-schema';
import {
  type CheckedDecision,
  type ComparisonCatalog,
  type ComparisonIdentity,
  type DecisionKind,
  type DecisionStates,
  type DecidedVersion,
  type RouteCatalog,
  type VersionIdentity,
  decidedKey,
  decisionStates,
} from '@arca/domain';
import type { Logger } from '@arca/telemetry';
import { sql } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';
import type { SignedIn } from '../auth/service.js';
import type { StepUpSpender } from '../auth/step-up.js';
import { subjectHash, type CanonicalAction } from '../auth/step-up-encoding.js';
import { reverifyStepUp } from '../auth/step-up-reverify.js';
import { closeRuleReports } from './reports.js';

export type DecisionOutcome =
  | { readonly decided: string }
  | { readonly refused: 'not_approver' | 'not_found' | 'already_rejected' | 'step_up_required' };

/** The version a decision is about: a route version or a comparison version (ADR-0026). */
export type DecisionTarget =
  | (DecideVersionRequest & { readonly subject: 'route' })
  | (DecideComparisonRequest & { readonly subject: 'comparison' });

export interface KnowledgeDecisions {
  readonly isApprover: (accountId: string) => boolean;
  /**
   * Activates or rejects one version (spec 0007, R7; ADR-0026) with this session's
   * `knowledge_decision` step-up, bound to the subject kind through its action, to the version's
   * hash in the bundled catalog and to the client's action nonce.
   */
  readonly decide: (
    signedIn: SignedIn,
    kind: DecisionKind,
    target: DecisionTarget,
    actionNonce: Uint8Array,
  ) => Promise<DecisionOutcome>;
  /** Every decided version's state, from the decisions that count; the engine's `states`. */
  readonly states: () => Promise<DecisionStates>;
}

export interface KnowledgeDecisionSettings {
  /** A database on the app_api pool, which reads the decisions. */
  readonly db: Database;
  /** Spends the step-up and stores the decision in one app_auth transaction. */
  readonly stepUp: StepUpSpender;
  readonly audit: AuditLog;
  readonly catalog: Pick<RouteCatalog, 'identities'>;
  /** The only place a comparison hash is taken from: an indicator's hash alone is never decided. */
  readonly comparisons: Pick<ComparisonCatalog, 'identities'>;
  readonly approvers: readonly string[];
  /** The environment's own origin; its host is the relying-party ID, as for every step-up. */
  readonly origin: string;
  readonly logger: Logger;
}

const routeActions = { activate: 'activateVersion', reject: 'rejectVersion' } as const;
const comparisonActions = { activate: 'activateComparison', reject: 'rejectComparison' } as const;

type DecisionRow = typeof decision.$inferSelect;

/** A version from the bundled catalog with its subject kind; a route's carries what it corrects. */
type BundledVersion =
  | { readonly subject: 'route'; readonly identity: VersionIdentity }
  | { readonly subject: 'comparison'; readonly identity: ComparisonIdentity };

/**
 * The step-up action of a decision. Each subject kind has its own actions, so an approval of one
 * kind never verifies as the other, and route subjects stay as they were (ADR-0026).
 */
function decisionAction(
  kind: DecisionKind,
  decided: DecidedVersion,
  nonce: Uint8Array,
): CanonicalAction {
  const { number, hash } = decided.identity;
  const action =
    decided.subject === 'route'
      ? decideVersionAction(routeActions[kind], { routeId: decided.identity.routeId, number }, hash)
      : decideComparisonAction(
          comparisonActions[kind],
          { comparisonId: decided.identity.comparisonId, number },
          hash,
        );
  return { ...action, nonce };
}

/** The audit event of a decision, naming the version it covers. */
function decisionEvent(kind: DecisionKind, decided: DecidedVersion, decisionId: string) {
  const { number } = decided.identity;
  if (decided.subject === 'route') {
    const { routeId } = decided.identity;
    return kind === 'activate'
      ? { code: 'version_activated' as const, details: { decisionId, routeId, number } }
      : { code: 'version_rejected' as const, details: { decisionId, routeId, number } };
  }
  const { comparisonId } = decided.identity;
  return kind === 'activate'
    ? { code: 'comparison_activated' as const, details: { decisionId, comparisonId, number } }
    : { code: 'comparison_rejected' as const, details: { decisionId, comparisonId, number } };
}

/**
 * The version a stored row decided, by its own subject kind; undefined for a row whose IDs do not
 * fit its kind, which the database's check refuses, so such a row counts for nothing.
 */
function rowVersion(row: DecisionRow): DecidedVersion | undefined {
  const { versionNumber: number, contentHash: hash } = row;
  if (row.subjectKind === 'route' && row.routeId !== null && row.comparisonId === null) {
    return { subject: 'route', identity: { routeId: row.routeId, number, hash } };
  }
  if (row.subjectKind === 'comparison' && row.comparisonId !== null && row.routeId === null) {
    return { subject: 'comparison', identity: { comparisonId: row.comparisonId, number, hash } };
  }
  return undefined;
}

export function createKnowledgeDecisions({
  db,
  stepUp,
  audit,
  catalog,
  comparisons,
  approvers,
  origin,
  logger,
}: KnowledgeDecisionSettings): KnowledgeDecisions {
  const rpId = new URL(origin).hostname;
  const listed = new Set(approvers);
  /**
   * Decisions never change, and the list is fixed for the process, so each decision is checked
   * once. The whole checked decision is kept, built from the row that was verified, so a row
   * changed later behind the policies cannot borrow an earlier verification.
   */
  const checkedById = new Map<string, Promise<CheckedDecision | undefined>>();

  const assertionVerifies = (row: DecisionRow, decided: DecidedVersion) =>
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
        subjectHash: subjectHash(decisionAction(row.kind, decided, row.actionNonce)),
        credentialId: row.credentialId,
        publicKey: new Uint8Array(row.publicKey),
        rpId,
        origin,
      },
    );

  const check = async (row: DecisionRow): Promise<CheckedDecision | undefined> => {
    const decided = rowVersion(row);
    const verified =
      decided !== undefined &&
      listed.has(row.approverAccountId) &&
      (await assertionVerifies(row, decided));
    if (!verified && row.kind === 'activate') {
      logger.error({ errorName: 'KnowledgeActivationIgnored' });
    }
    return decided === undefined ? undefined : { ...decided, kind: row.kind, verified };
  };

  const checked = (row: DecisionRow) => {
    let known = checkedById.get(row.id);
    if (known === undefined) {
      known = check(row);
      checkedById.set(row.id, known);
    }
    return known;
  };

  const states = async () => {
    const rows = await db.select().from(decision).orderBy(decision.decidedAt, decision.id);
    const decisions = await Promise.all(rows.map(checked));
    return decisionStates(decisions.filter((each) => each !== undefined));
  };

  /** The target's identity in the bundled catalog: the only source of a hash to decide on. */
  const bundled = (target: DecisionTarget): BundledVersion | undefined => {
    if (target.subject === 'route') {
      const identity = catalog
        .identities(target.routeId)
        .find(({ number }) => number === target.number);
      return identity === undefined ? undefined : { subject: 'route', identity };
    }
    const identity = comparisons
      .identities()
      .find(
        ({ comparisonId, number }) =>
          comparisonId === target.comparisonId && number === target.number,
      );
    return identity === undefined ? undefined : { subject: 'comparison', identity };
  };

  return {
    isApprover: (accountId) => listed.has(accountId),

    decide: async (signedIn, kind, target, actionNonce) => {
      const { accountId } = signedIn;
      if (!listed.has(accountId)) return { refused: 'not_approver' };
      const decided = bundled(target);
      if (decided === undefined) return { refused: 'not_found' };
      if ((await states()).get(decidedKey(decided)) === 'rejected') {
        return { refused: 'already_rejected' };
      }
      const { identity } = decided;
      const routeId = decided.subject === 'route' ? decided.identity.routeId : null;
      const comparisonId = decided.subject === 'comparison' ? decided.identity.comparisonId : null;
      const decisionId = randomUUID();
      // The decision is stored on app_auth, in the transaction that spends its step-up, so only a
      // role that can already write credentials can store one (ADR-0022); app_api only reads.
      const stored = await stepUp.spend(
        signedIn,
        'knowledge_decision',
        decisionAction(kind, decided, actionNonce),
        async (tx, spent) => {
          // Committed first, on app_audit: a decision no event records must never be stored, so an
          // insert that fails after it leaves an event naming a decision that does not exist.
          await audit.record({
            ...decisionEvent(kind, decided, decisionId),
            subjectAccountId: accountId,
            actorAccountId: accountId,
          });
          await tx.execute(sql`
          INSERT INTO knowledge.decision (id, kind, subject_kind, route_id, comparison_id,
            version_number, content_hash, approver_account_id, credential_id, public_key,
            action_nonce, server_nonce, authenticator_data, client_data_json, signature, step_up_id)
          VALUES (${decisionId}, ${kind}, ${decided.subject}, ${routeId}, ${comparisonId},
            ${identity.number}, ${identity.hash}, ${accountId}, ${spent.credentialId},
            ${Buffer.from(spent.publicKey)}, ${Buffer.from(actionNonce)},
            ${Buffer.from(spent.nonce)}, ${Buffer.from(spent.authenticatorData)},
            ${Buffer.from(spent.clientDataJson)}, ${Buffer.from(spent.signature)}, ${spent.id})`);
        },
      );
      if (!stored) return { refused: 'step_up_required' };
      // Activating a correction answers the reports of the version it corrects (R8).
      // The decision stands either way; the approver can still close the reports by hand.
      if (
        kind === 'activate' &&
        decided.subject === 'route' &&
        decided.identity.corrects !== undefined
      ) {
        await closeRuleReports(db, decided.identity.routeId, decided.identity.corrects, null).catch(
          () => {
            logger.error({ errorName: 'RuleReportsNotClosed' });
          },
        );
      }
      return { decided: decisionId };
    },

    states,
  };
}
