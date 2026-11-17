import { randomUUID } from 'node:crypto';
import {
  type DecideComparisonRequest,
  type DecideOfficialDomainsRequest,
  type DecideVersionRequest,
  decideComparisonAction,
  decideOfficialDomainsAction,
  decideVersionAction,
} from '@arca/api-contract/routes';
import { type Database, type Transaction, actAs } from '@arca/db';
import { decision } from '@arca/db/knowledge-schema';
import {
  type CheckedDecision,
  type ComparisonCatalog,
  type ComparisonIdentity,
  type DecisionKind,
  type DecisionStates,
  type DecidedVersion,
  type OfficialDomainsIdentity,
  type Pin,
  type RouteCatalog,
  type VersionIdentity,
  decidedKey,
  decisionStates,
  officialDomainsKey,
} from '@arca/domain';
import type { VerifiedOfficialDomainList } from '@arca/knowledge';
import type { Logger } from '@arca/telemetry';
import { getTableColumns, sql } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';
import type { SignedIn } from '../auth/service.js';
import type { SpentStepUp, StepUpSpender } from '../auth/step-up.js';
import { subjectHash, type CanonicalAction } from '../auth/step-up-encoding.js';
import { reverifyStepUp, type StoredAssertion } from '../auth/step-up-reverify.js';
import { type AdminHistory, type AdminRole, epochMicros, readAdminHistory } from './admins.js';
import { closeRuleReports } from './reports.js';

export type DecisionOutcome =
  | { readonly decided: string }
  | {
      readonly refused:
        'not_admin' | 'not_found' | 'already_rejected' | 'step_up_required' | 'list_pending';
    };

/**
 * The version a decision is about: a route version, a comparison version (ADR-0026) or a first
 * official-domain list a new-route request proposed (ADR-0031).
 */
export type DecisionTarget =
  | (DecideVersionRequest & { readonly subject: 'route' })
  | (DecideComparisonRequest & { readonly subject: 'comparison' })
  | (DecideOfficialDomainsRequest & { readonly subject: 'official_domains' });

/** The official-domain lists the stored rules hold, and which ones each route version pins. */
export interface OfficialDomainsView {
  readonly lists: readonly VerifiedOfficialDomainList[];
  /** The lists a stored route version pins; undefined when it does not read. */
  readonly pinsOf: (routeId: string, number: number) => readonly Pin[] | undefined;
}

export interface KnowledgeDecisions {
  /**
   * Activates or rejects one version (spec 0007, R7; ADR-0026) for an admin who spent a
   * `knowledge_decision` step-up bound to the version's content hash in the stored rules and, for a
   * route version, the hash of its cases (ADR-0031), so the decision binds what the admin saw.
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
  readonly stepUp: Pick<StepUpSpender, 'spend'>;
  readonly audit: AuditLog;
  /** The route catalog over the stored rules (ADR-0031), read when a decision needs it. */
  readonly catalog: () => Promise<Pick<RouteCatalog, 'identities'>>;
  /** The hash of the cases of the route version read under this content hash (ADR-0031). */
  readonly casesHash: (contentHash: string) => Promise<string | undefined>;
  /** The only place a comparison hash is taken from: an indicator's hash alone is never decided. */
  readonly comparisons: Pick<ComparisonCatalog, 'identities'>;
  /** The stored official-domain lists, the only place a list's hash is taken from (ADR-0031). */
  readonly officialDomains: () => Promise<OfficialDomainsView>;
  /** Who is an admin: the owner list and the role's history (ADR-0027). */
  readonly role: AdminRole;
  /** The environment's own origin, which ADR-0022 decisions are re-verified against. */
  readonly origin: string;
  readonly logger: Logger;
}

const routeActions = { activate: 'activateVersion', reject: 'rejectVersion' } as const;
const comparisonActions = { activate: 'activateComparison', reject: 'rejectComparison' } as const;
const listActions = {
  activate: 'activateOfficialDomains',
  reject: 'rejectOfficialDomains',
} as const;

/** A stored decision, with its time in microseconds to compare with the role's history. */
type DecisionRow = typeof decision.$inferSelect & { readonly decidedMicros: string };

class NotAdmin extends Error {}

/**
 * Whether a `session` or `admin_step_up` row's recorded basis counts (ADR-0027): the owner list,
 * checked when the row was stored, or the grant it names, in force for its author at its time by
 * the history. A new basis must be handled here to compile.
 */
function basisCounts(row: DecisionRow, history: AdminHistory): boolean {
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

/** A version from the stored rules with its subject kind; a route's carries what it corrects. */
type KnownVersion =
  | { readonly subject: 'route'; readonly identity: VersionIdentity }
  | { readonly subject: 'comparison'; readonly identity: ComparisonIdentity }
  | { readonly subject: 'official_domains'; readonly identity: OfficialDomainsIdentity };

/**
 * The step-up action a decision was approved with. Each subject kind has its own actions, so an
 * approval of one kind never verifies as the other (ADR-0026); a route decision since ADR-0031 also
 * binds its cases hash, while an ADR-0022 one, which has none, binds the content hash alone.
 */
function decisionAction(
  kind: DecisionKind,
  decided: DecidedVersion,
  casesHash: string | null,
  nonce: Uint8Array,
): CanonicalAction {
  const { number, hash } = decided.identity;
  switch (decided.subject) {
    case 'route':
      return {
        ...decideVersionAction(
          routeActions[kind],
          { routeId: decided.identity.routeId, number },
          hash,
          casesHash ?? undefined,
        ),
        nonce,
      };
    case 'comparison':
      return {
        ...decideComparisonAction(
          comparisonActions[kind],
          { comparisonId: decided.identity.comparisonId, number },
          hash,
        ),
        nonce,
      };
    case 'official_domains':
      return {
        ...decideOfficialDomainsAction(
          listActions[kind],
          { listId: decided.identity.listId, number },
          hash,
        ),
        nonce,
      };
  }
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
  if (decided.subject === 'official_domains') {
    const { listId } = decided.identity;
    return kind === 'activate'
      ? { code: 'official_domains_activated' as const, details: { decisionId, listId, number } }
      : { code: 'official_domains_rejected' as const, details: { decisionId, listId, number } };
  }
  const { comparisonId } = decided.identity;
  return kind === 'activate'
    ? { code: 'comparison_activated' as const, details: { decisionId, comparisonId, number } }
    : { code: 'comparison_rejected' as const, details: { decisionId, comparisonId, number } };
}

/** What a step-up row copied from its step-up; undefined on a `session` row. */
interface StoredStepUp {
  readonly assertion: StoredAssertion;
  readonly publicKey: Uint8Array<ArrayBuffer>;
  readonly actionNonce: Uint8Array;
}

function storedStepUp(row: DecisionRow): StoredStepUp | undefined {
  const { credentialId, serverNonce, authenticatorData, clientDataJson, signature } = row;
  const { publicKey, actionNonce } = row;
  if (
    row.proof === 'session' ||
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
  const { versionNumber: number, contentHash: hash, routeId, comparisonId, listId } = row;
  if (row.subjectKind === 'route' && routeId !== null && comparisonId === null && listId === null) {
    return { subject: 'route', identity: { routeId, number, hash } };
  }
  if (
    row.subjectKind === 'comparison' &&
    comparisonId !== null &&
    routeId === null &&
    listId === null
  ) {
    return { subject: 'comparison', identity: { comparisonId, number, hash } };
  }
  if (
    row.subjectKind === 'official_domains' &&
    listId !== null &&
    routeId === null &&
    comparisonId === null &&
    row.proof === 'admin_step_up'
  ) {
    return { subject: 'official_domains', identity: { listId, number, hash } };
  }
  return undefined;
}

export function createKnowledgeDecisions({
  db,
  stepUp,
  audit,
  catalog,
  casesHash,
  comparisons,
  officialDomains,
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

  /** An ADR-0022 row needs its author on the owner list; an ADR-0031 row needs its basis. */
  const assertionVerifies = async (row: DecisionRow, decided: DecidedVersion) => {
    const stored = storedStepUp(row);
    if (stored === undefined || (row.proof === 'step_up' && !role.isOwner(row.authorAccountId))) {
      return false;
    }
    return reverifyStepUp(stored.assertion, {
      purpose: 'knowledge_decision',
      subjectHash: subjectHash(
        decisionAction(row.kind, decided, row.casesHash, stored.actionNonce),
      ),
      credentialId: stored.assertion.credentialId,
      publicKey: stored.publicKey,
      rpId,
      origin,
    });
  };

  /**
   * A stored decision as it counts (ADR-0027, ADR-0031). A `session` row counts by the basis it
   * records: the owner list keeps no history, so an `owner_list` row, checked against the list when
   * app_auth stored it, keeps counting after its author leaves the list, and losing the role never
   * revives a version its author rejected. A `step_up` row is re-verified as ADR-0022 says; an
   * `admin_step_up` row is re-verified and its basis must count. A rejection counts even when it
   * does not verify.
   */
  const check = async (
    row: DecisionRow,
    history: AdminHistory,
  ): Promise<CheckedDecision | undefined> => {
    const decided = rowVersion(row);
    if (decided === undefined) return undefined;
    if (row.proof === 'session')
      return basisCounts(row, history) ? { ...decided, kind: row.kind, verified: true } : undefined;
    const verified =
      (row.proof === 'step_up' || basisCounts(row, history)) &&
      (await assertionVerifies(row, decided));
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

  /** The target's identity in the stored rules: the only source of a hash to decide on. */
  const versionOf = async (target: DecisionTarget): Promise<KnownVersion | undefined> => {
    if (target.subject === 'official_domains') {
      // Only a list a request proposed is decided; an imported one passed a reviewed pull request.
      const list = (await officialDomains()).lists.find(
        ({ id, number, fromRequest }) =>
          fromRequest && id === target.listId && number === target.number,
      );
      return list === undefined
        ? undefined
        : {
            subject: 'official_domains',
            identity: { listId: list.id, number: list.number, hash: list.hash },
          };
    }
    if (target.subject === 'route') {
      const identity = (await catalog())
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
   * The versions an `admin_step_up` row names by ID and number whose stored rules now hash
   * otherwise, content or cases: such a row was changed in place, so it is refused, as rejected,
   * instead of reading as a new proposed version (ADR-0031). Older rows were stored when every
   * version passed a reviewed pull request, and are left as they count.
   */
  const changedSinceDecided = async (rows: readonly DecisionRow[]) => {
    const decided = rows.flatMap((row) => {
      const version = row.proof === 'admin_step_up' ? rowVersion(row) : undefined;
      return version === undefined ? [] : [{ row, version }];
    });
    if (decided.length === 0) return [];
    const routes = await catalog();
    const { lists } = await officialDomains();
    const casesByHash = new Map<string, Promise<string | undefined>>();
    const casesOf = (hash: string) => {
      let known = casesByHash.get(hash);
      if (known === undefined) {
        known = casesHash(hash);
        casesByHash.set(hash, known);
      }
      return known;
    };
    const refused: DecidedVersion[] = [];
    for (const { row, version } of decided) {
      const known = knownNow(version, routes, lists);
      if (known === undefined) continue;
      const changed =
        known.identity.hash !== row.contentHash ||
        (known.subject === 'route' && (await casesOf(known.identity.hash)) !== row.casesHash);
      if (changed) {
        logger.error({ errorName: 'KnowledgeDecidedVersionChanged' });
        refused.push(known);
      }
    }
    return refused;
  };

  /** The version a decided one names by ID and number, as the stored rules hold it now. */
  const knownNow = (
    version: DecidedVersion,
    routes: Pick<RouteCatalog, 'identities'>,
    lists: readonly VerifiedOfficialDomainList[],
  ): DecidedVersion | undefined => {
    const { number } = version.identity;
    switch (version.subject) {
      case 'route': {
        const identity = routes
          .identities(version.identity.routeId)
          .find((each) => each.number === number);
        return identity === undefined ? undefined : { subject: 'route', identity };
      }
      case 'comparison': {
        const identity = comparisons
          .identities()
          .find(
            (each) => each.comparisonId === version.identity.comparisonId && each.number === number,
          );
        return identity === undefined ? undefined : { subject: 'comparison', identity };
      }
      case 'official_domains': {
        const list = lists.find(
          ({ id, number: listNumber }) => id === version.identity.listId && listNumber === number,
        );
        return list === undefined
          ? undefined
          : { subject: 'official_domains', identity: { listId: list.id, number, hash: list.hash } };
      }
    }
  };

  /**
   * Whether a route version pins a first official-domain list a request proposed that is not
   * active: the list is decided apart, before the route (ADR-0031).
   */
  const pinsPendingList = async (
    identity: VersionIdentity,
    current: DecisionStates,
  ): Promise<boolean> => {
    const { lists, pinsOf } = await officialDomains();
    const pins = pinsOf(identity.routeId, identity.number) ?? [];
    return pins.some((pin) => {
      const list = lists.find(({ id, number }) => id === pin.id && number === pin.number);
      if (list === undefined) return true;
      const key = officialDomainsKey({ listId: list.id, number: list.number, hash: list.hash });
      return list.fromRequest && current.get(key) !== 'active';
    });
  };

  const states = async () => {
    // One snapshot, so every grant a decision names is read with it.
    const { rows, history } = await db.transaction(
      async (tx) => ({
        rows: (await tx
          .select({ ...getTableColumns(decision), decidedMicros: epochMicros(decision.decidedAt) })
          .from(decision)
          .orderBy(decision.decidedAt, decision.id)) as DecisionRow[],
        history: await readAdminHistory(tx),
      }),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
    const decisions = await Promise.all(rows.map((row) => checked(row, history)));
    const refused = (await changedSinceDecided(rows)).map((decided): CheckedDecision => ({
      ...decided,
      kind: 'reject',
      verified: false,
    }));
    return decisionStates([...decisions.filter((each) => each !== undefined), ...refused]);
  };

  /**
   * Stores one decision as the author's own `admin_step_up` row, in the app_auth transaction that
   * spends the step-up, under the author's identity: the lock on the author, the admin check, the
   * audit event, then the row, which copies the step-up, names why its author was an admin and has
   * the time the database sets after the lock. Throws NotAdmin, so nothing is spent or stored.
   */
  const store = async (
    tx: Transaction,
    accountId: string,
    kind: DecisionKind,
    decided: DecidedVersion,
    cases: string | null,
    { nonce: actionNonce, spent }: { nonce: Uint8Array; spent: SpentStepUp },
    id: string,
  ) => {
    await actAs(tx, accountId);
    const held = await role.held(tx, accountId);
    if (held === undefined) throw new NotAdmin();
    const { basis, grantId } = held.basis;
    const { identity } = decided;
    const routeId = decided.subject === 'route' ? decided.identity.routeId : null;
    const comparisonId = decided.subject === 'comparison' ? decided.identity.comparisonId : null;
    const listId = decided.subject === 'official_domains' ? decided.identity.listId : null;
    // Committed first, on app_audit: a decision no event records must never be stored, so an
    // insert that fails after it leaves an event naming a decision that does not exist.
    await audit.record({
      ...decisionEvent(kind, decided, id),
      subjectAccountId: accountId,
      actorAccountId: accountId,
    });
    await tx.execute(sql`
      INSERT INTO knowledge.decision (id, kind, subject_kind, route_id, comparison_id, list_id,
        version_number, content_hash, cases_hash, approver_account_id, proof, admin_basis,
        admin_grant_id, credential_id, public_key, action_nonce, server_nonce, authenticator_data,
        client_data_json, signature, step_up_id)
      VALUES (${id}, ${kind}, ${decided.subject}, ${routeId}, ${comparisonId}, ${listId},
        ${identity.number}, ${identity.hash}, ${cases}, ${accountId}, 'admin_step_up', ${basis},
        ${grantId}, ${spent.credentialId}, ${Buffer.from(spent.publicKey)},
        ${Buffer.from(actionNonce)}, ${Buffer.from(spent.nonce)},
        ${Buffer.from(spent.authenticatorData)}, ${Buffer.from(spent.clientDataJson)},
        ${Buffer.from(spent.signature)}, ${spent.id})`);
  };

  return {
    decide: async (signedIn, kind, target, actionNonce) => {
      const { accountId } = signedIn;
      // Anyone else learns nothing about the catalog; the storing transaction checks again.
      if (!(await role.isAdmin(accountId))) return { refused: 'not_admin' };
      const decided = await versionOf(target);
      if (decided === undefined) return { refused: 'not_found' };
      const cases = decided.subject === 'route' ? await casesHash(decided.identity.hash) : null;
      if (cases === undefined) return { refused: 'not_found' };
      const current = await states();
      if (current.get(decidedKey(decided)) === 'rejected') {
        return { refused: 'already_rejected' };
      }
      if (
        kind === 'activate' &&
        decided.subject === 'route' &&
        (await pinsPendingList(decided.identity, current))
      ) {
        return { refused: 'list_pending' };
      }
      const decisionId = randomUUID();
      try {
        const spent = await stepUp.spend(
          signedIn,
          'knowledge_decision',
          decisionAction(kind, decided, cases, actionNonce),
          (tx, stepUpSpent) =>
            store(
              tx,
              accountId,
              kind,
              decided,
              cases,
              { nonce: actionNonce, spent: stepUpSpent },
              decisionId,
            ),
        );
        if (!spent) return { refused: 'step_up_required' };
      } catch (error) {
        if (error instanceof NotAdmin) return { refused: 'not_admin' };
        throw error;
      }
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
