import { randomUUID } from 'node:crypto';
import {
  type DecideComparisonRequest,
  type DecideVersionRequest,
  decideComparisonAction,
  decideVersionAction,
} from '@arca/api-contract/routes';
import { type Database, type Transaction, withIdentity } from '@arca/db';
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
import { getTableColumns, sql } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';
import type { SignedIn } from '../auth/service.js';
import { subjectHash, type CanonicalAction } from '../auth/step-up-encoding.js';
import { reverifyStepUp, type StoredAssertion } from '../auth/step-up-reverify.js';
import { type AdminHistory, type AdminRole, epochMicros, readAdminHistory } from './admins.js';
import { closeRuleReports } from './reports.js';

export type DecisionOutcome =
  | { readonly decided: string }
  | { readonly refused: 'not_admin' | 'not_found' | 'already_rejected' };

/** The version a decision is about: a route version or a comparison version (ADR-0026). */
export type DecisionTarget =
  | (DecideVersionRequest & { readonly subject: 'route' })
  | (DecideComparisonRequest & { readonly subject: 'comparison' });

export interface KnowledgeDecisions {
  /**
   * Activates or rejects one version (spec 0007, R7; ADR-0026) for a signed-in admin, with no
   * step-up (ADR-0027), on the version's hash in the bundled catalog.
   */
  readonly decide: (
    signedIn: SignedIn,
    kind: DecisionKind,
    target: DecisionTarget,
  ) => Promise<DecisionOutcome>;
  /** Every decided version's state, from the decisions that count; the engine's `states`. */
  readonly states: () => Promise<DecisionStates>;
}

export interface KnowledgeDecisionSettings {
  /** A database on the app_api pool, which reads the decisions. */
  readonly db: Database;
  /**
   * The app_auth pool, the only role that stores a decision; opened on the first decision, so
   * reading the states never needs the auth role's settings.
   */
  readonly authDb: () => Database;
  readonly audit: AuditLog;
  readonly catalog: Pick<RouteCatalog, 'identities'>;
  /** The only place a comparison hash is taken from: an indicator's hash alone is never decided. */
  readonly comparisons: Pick<ComparisonCatalog, 'identities'>;
  /** Who is an admin: the owner list and the role's history (ADR-0027). */
  readonly role: AdminRole;
  /** The environment's own origin, which ADR-0022 decisions are re-verified against. */
  readonly origin: string;
  readonly logger: Logger;
}

const routeActions = { activate: 'activateVersion', reject: 'rejectVersion' } as const;
const comparisonActions = { activate: 'activateComparison', reject: 'rejectComparison' } as const;

/** A stored decision, with its time in microseconds to compare with the role's history. */
type DecisionRow = typeof decision.$inferSelect & { readonly decidedMicros: string };

/**
 * Whether a `session` row's recorded basis counts (ADR-0027): the owner list, checked when the
 * row was stored, or the grant it names, in force for its author at its time by the history. A
 * new basis must be handled here to compile.
 */
function sessionCounts(row: DecisionRow, history: AdminHistory): boolean {
  const { adminBasis } = row;
  switch (adminBasis) {
    case 'owner_list':
      return true;
    case 'grant':
      return (
        row.adminGrantId !== null &&
        history.inForce(row.adminGrantId, row.authorAccountId, BigInt(row.decidedMicros))
      );
    case null:
      return false;
    default: {
      const unhandled: never = adminBasis;
      return unhandled;
    }
  }
}

/** A version from the bundled catalog with its subject kind; a route's carries what it corrects. */
type BundledVersion =
  | { readonly subject: 'route'; readonly identity: VersionIdentity }
  | { readonly subject: 'comparison'; readonly identity: ComparisonIdentity };

/**
 * The step-up action an ADR-0022 decision was approved with. Each subject kind has its own
 * actions, so an approval of one kind never verifies as the other (ADR-0026).
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

/** What an ADR-0022 row copied from its step-up; undefined on any other row. */
interface StoredStepUp {
  readonly assertion: StoredAssertion;
  readonly publicKey: Uint8Array<ArrayBuffer>;
  readonly actionNonce: Uint8Array;
}

function storedStepUp(row: DecisionRow): StoredStepUp | undefined {
  const { credentialId, serverNonce, authenticatorData, clientDataJson, signature } = row;
  const { publicKey, actionNonce } = row;
  if (
    row.proof !== 'step_up' ||
    credentialId === null ||
    serverNonce === null ||
    authenticatorData === null ||
    clientDataJson === null ||
    signature === null ||
    publicKey === null ||
    actionNonce === null
  ) {
    return undefined;
  }
  return {
    assertion: { credentialId, nonce: serverNonce, authenticatorData, clientDataJson, signature },
    publicKey: new Uint8Array(publicKey),
    actionNonce,
  };
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
  authDb,
  audit,
  catalog,
  comparisons,
  role,
  origin,
  logger,
}: KnowledgeDecisionSettings): KnowledgeDecisions {
  const rpId = new URL(origin).hostname;
  /**
   * Decisions never change, the owner list is fixed for the process, and the history only grows
   * after the times a stored row looks at, so each decision is checked once. The whole checked
   * decision is kept, built from the row that was verified, so a row changed later behind the
   * policies cannot borrow an earlier verification.
   */
  const checkedById = new Map<string, Promise<CheckedDecision | undefined>>();

  const assertionVerifies = async (row: DecisionRow, decided: DecidedVersion) => {
    const stored = storedStepUp(row);
    if (stored === undefined || !role.isOwner(row.authorAccountId)) return false;
    return reverifyStepUp(stored.assertion, {
      purpose: 'knowledge_decision',
      subjectHash: subjectHash(decisionAction(row.kind, decided, stored.actionNonce)),
      credentialId: stored.assertion.credentialId,
      publicKey: stored.publicKey,
      rpId,
      origin,
    });
  };

  /**
   * A stored decision as it counts (ADR-0027). A `session` row counts by the basis it records: the
   * owner list keeps no history, so an `owner_list` row, checked against the list when app_auth
   * stored it, keeps counting after its author leaves the list, and losing the role never revives
   * a version its author rejected. A `step_up` row is re-verified as ADR-0022 says, and its
   * rejection counts even when it does not verify.
   */
  const check = async (
    row: DecisionRow,
    history: AdminHistory,
  ): Promise<CheckedDecision | undefined> => {
    const decided = rowVersion(row);
    if (decided === undefined) return undefined;
    if (row.proof === 'session')
      return sessionCounts(row, history)
        ? { ...decided, kind: row.kind, verified: true }
        : undefined;
    const verified = await assertionVerifies(row, decided);
    if (!verified && row.kind === 'activate') {
      logger.error({ errorName: 'KnowledgeActivationIgnored' });
    }
    return { ...decided, kind: row.kind, verified };
  };

  const checked = (row: DecisionRow, history: AdminHistory) => {
    let known = checkedById.get(row.id);
    if (known === undefined) {
      known = check(row, history);
      checkedById.set(row.id, known);
    }
    return known;
  };

  const states = async () => {
    // One snapshot, so every grant a decision names is read with it.
    const { rows, history } = await db.transaction(
      async (tx) => ({
        rows: await tx
          .select({ ...getTableColumns(decision), decidedMicros: epochMicros(decision.decidedAt) })
          .from(decision)
          .orderBy(decision.decidedAt, decision.id),
        history: await readAdminHistory(tx),
      }),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
    const decisions = await Promise.all(rows.map((row) => checked(row as DecisionRow, history)));
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

  /**
   * Stores one decision as the author's own `session` row, in one app_auth transaction under the
   * author's identity: the lock on the author, the admin check, the audit event, then the row,
   * whose time the database sets after the lock and which names why its author was an admin.
   * False, with nothing stored, for a non-admin.
   */
  const store = (accountId: string, kind: DecisionKind, decided: DecidedVersion, id: string) =>
    withIdentity(authDb(), { accountId }, async (tx: Transaction) => {
      const held = await role.held(tx, accountId);
      if (held === undefined) return false;
      const { basis, grantId } = held.basis;
      const { identity } = decided;
      const routeId = decided.subject === 'route' ? decided.identity.routeId : null;
      const comparisonId = decided.subject === 'comparison' ? decided.identity.comparisonId : null;
      // Committed first, on app_audit: a decision no event records must never be stored, so an
      // insert that fails after it leaves an event naming a decision that does not exist.
      await audit.record({
        ...decisionEvent(kind, decided, id),
        subjectAccountId: accountId,
        actorAccountId: accountId,
      });
      await tx.execute(sql`
        INSERT INTO knowledge.decision (id, kind, subject_kind, route_id, comparison_id,
          version_number, content_hash, approver_account_id, proof, admin_basis, admin_grant_id)
        VALUES (${id}, ${kind}, ${decided.subject}, ${routeId}, ${comparisonId},
          ${identity.number}, ${identity.hash}, ${accountId}, 'session', ${basis}, ${grantId})`);
      return true;
    });

  return {
    decide: async ({ accountId }, kind, target) => {
      // Anyone else learns nothing about the catalog; the storing transaction checks again.
      if (!(await role.isAdmin(accountId))) return { refused: 'not_admin' };
      const decided = bundled(target);
      if (decided === undefined) return { refused: 'not_found' };
      if ((await states()).get(decidedKey(decided)) === 'rejected') {
        return { refused: 'already_rejected' };
      }
      const decisionId = randomUUID();
      if (!(await store(accountId, kind, decided, decisionId))) return { refused: 'not_admin' };
      // Activating a correction answers the reports of the version it corrects (R8).
      // The decision stands either way; an admin can still close the reports by hand.
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
