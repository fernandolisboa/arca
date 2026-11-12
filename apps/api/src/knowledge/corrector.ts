import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  type CorrectionAnswer,
  type CorrectorKeyStatus,
  type CorrectorRequests,
  type CreatedCorrectorKey,
  type ListedCorrectionSource,
  correctorKeyPattern,
  correctorKeyPrefix,
  createCorrectorKeyAction,
} from '@arca/api-contract/routes';
import { actAs, type Database, withIdentity } from '@arca/db';
import {
  type CorrectionItemKind,
  type DecisionStates,
  correctionAnswerRefusal,
  correctionState,
  routeCountry,
} from '@arca/domain';
import { sql } from 'drizzle-orm';
import type { AccountNotice } from '../auth/account-notices.js';
import type { SignedIn } from '../auth/service.js';
import type { StepUpSpender } from '../auth/step-up.js';
import type { AuditLog } from '../audit/log.js';
import type { ObjectStorage } from '../storage/object-storage.js';
import { type AdminRole, readAdminHistory } from './admins.js';
import type { KnowledgeVersions } from './versions.js';

/** How long a key works after it is made (ADR-0029); the database enforces the same year. */
const keyLifetimeYears = 1;

/** The most requests one listing serves (ADR-0029). */
export const correctorListLimit = 10;

/** The live key a request presented: its row, its digest and the owner-list admin who made it. */
export interface PresentedKey {
  readonly id: string;
  readonly digest: Buffer;
  readonly creatorId: string;
}

type ManageRefusal = 'not_admin' | 'owner_list_only';

/** The corrector key, as the owner-list admins manage it in settings (ADR-0029). */
export interface CorrectorKeys {
  readonly status: (accountId: string) => Promise<CorrectorKeyStatus | 'not_admin'>;
  /** Makes a key that replaces the live one, spending the session's `corrector_key` step-up. */
  readonly create: (
    signedIn: SignedIn,
    nonce: Uint8Array,
  ) => Promise<CreatedCorrectorKey | ManageRefusal | 'step_up_required'>;
  readonly revoke: (
    accountId: string,
    keyId: string,
  ) => Promise<'revoked' | ManageRefusal | 'not_found'>;
}

export type AnswerOutcome = 'stored' | 'not_found' | 'wrong_state' | 'invalid_version';

/** What the corrector run may do with the live key (ADR-0029); it never closes a request. */
export interface Corrector {
  /** The live key the `Authorization` header carries, compared by digest in constant time. */
  readonly authenticate: (authorization: string | undefined) => Promise<PresentedKey | undefined>;
  /** Audits a refused key with identifiers only; the caller rate limits it first. */
  readonly refused: () => Promise<void>;
  readonly list: (key: PresentedKey) => Promise<CorrectorRequests>;
  readonly fileUrl: (
    key: PresentedKey,
    requestId: string,
    position: number,
  ) => Promise<{ readonly url: string } | 'not_found'>;
  readonly answer: (
    key: PresentedKey,
    requestId: string,
    answer: CorrectionAnswer,
  ) => Promise<AnswerOutcome>;
}

export interface CorrectorSettings {
  /** The app_api pool, which may only execute the definer functions on these tables. */
  readonly db: () => Database;
  readonly role: AdminRole;
  /** Whether the account still exists, confirmed; false once it is erased. */
  readonly accountConfirmed: (accountId: string) => Promise<boolean>;
  readonly stepUp: StepUpSpender;
  readonly versions: Pick<KnowledgeVersions, 'identities'>;
  readonly states: () => Promise<DecisionStates>;
  readonly audit: Pick<AuditLog, 'record'>;
  readonly notify: AccountNotice<'corrector_key_changed'>;
  readonly storage: ObjectStorage;
}

interface LiveKey extends Record<string, unknown> {
  id: string;
  key_sha256: Buffer;
  actor_account_id: string;
  created_at: string | Date;
}

/** A request as `corrector_request_queue` serves it: on a version, or for a new route. */
interface StoredRequest extends Record<string, unknown> {
  id: string;
  route_id: string | null;
  version_number: number | null;
  country_code: string | null;
  item_kind: CorrectionItemKind | 'newRoute';
  item_key: string | null;
  note: string | null;
  created_at: string | Date;
  sources: ListedCorrectionSource[];
  events: { kind: 'taken' }[];
}

type WorkableRequest = CorrectorRequests['requests'][number];

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/** The token of `Bearer <token>`, or the empty string for any other header. */
const bearerToken = (authorization: string | undefined) =>
  authorization?.startsWith('Bearer ') === true ? authorization.slice('Bearer '.length) : '';

const expiry = (createdAt: Date) => {
  const expires = new Date(createdAt);
  expires.setUTCFullYear(expires.getUTCFullYear() + keyLifetimeYears);
  return expires;
};

/** A refused request compares against this, so a missing live key takes the same time. */
const noKeyDigest = randomBytes(32);

export function createCorrector({
  db,
  role,
  accountConfirmed,
  stepUp,
  versions,
  states,
  audit,
  notify,
  storage,
}: CorrectorSettings): { readonly keys: CorrectorKeys; readonly corrector: Corrector } {
  /** The live key, if its creator is still on the owner list and still has an account. */
  const usableKey = async (): Promise<LiveKey | undefined> => {
    const { rows } = await db().execute<LiveKey>(
      sql`SELECT id, key_sha256, actor_account_id, created_at FROM knowledge.live_corrector_key()`,
    );
    const [live] = rows;
    if (live === undefined || !role.isOwner(live.actor_account_id)) return undefined;
    return (await accountConfirmed(live.actor_account_id)) ? live : undefined;
  };

  /** The basis of an admin who may manage the key: the owner list, which lives in code. */
  const manageBasis = async (accountId: string): Promise<ManageRefusal | undefined> => {
    const basis = role.basisOf(await readAdminHistory(db()), accountId);
    if (basis === undefined) return 'not_admin';
    return basis.basis === 'owner_list' ? undefined : 'owner_list_only';
  };

  const tellOwners = () =>
    Promise.all(role.ownerList.map((ownerId) => notify(ownerId, 'corrector_key_changed')));

  /** Every open or taken request, oldest first, by its computed state. */
  const workable = async (key: PresentedKey): Promise<WorkableRequest[]> => {
    const [{ rows }, decided] = await Promise.all([
      db().execute<StoredRequest>(sql`
        SELECT * FROM knowledge.corrector_request_queue(${key.id}::uuid, ${key.digest})`),
      states(),
    ]);
    return rows.flatMap((row) => {
      const state = correctionState({
        versionNumber: row.version_number,
        events: row.events,
        identities: row.route_id === null ? [] : versions.identities(row.route_id),
        states: decided,
      });
      if (state !== 'open' && state !== 'taken') return [];
      return [
        {
          id: row.id,
          routeId: row.route_id,
          versionNumber: row.version_number,
          item: row.item_kind === 'newRoute' ? null : { kind: row.item_kind, key: row.item_key },
          countryCode: row.country_code,
          note: row.note,
          createdAt: new Date(row.created_at).toISOString(),
          sources: row.sources,
          state,
        },
      ];
    });
  };

  /** A use of the key the routes refused, audited with identifiers only (ADR-0029). */
  const refusedUse = (
    key: PresentedKey,
    requestId: string,
    outcome: Exclude<AnswerOutcome, 'stored'>,
  ) =>
    audit.record({
      code: 'corrector_use_refused',
      subjectAccountId: key.creatorId,
      actorAccountId: null,
      details: { keyId: key.id, requestId, outcome },
    });

  const keys: CorrectorKeys = {
    status: async (accountId) => {
      const basis = role.basisOf(await readAdminHistory(db()), accountId);
      if (basis === undefined) return 'not_admin';
      const live = await usableKey();
      const createdAt = live === undefined ? undefined : new Date(live.created_at);
      return {
        canManage: basis.basis === 'owner_list',
        key:
          live === undefined || createdAt === undefined
            ? null
            : {
                id: live.id,
                createdAt: createdAt.toISOString(),
                expiresAt: expiry(createdAt).toISOString(),
              },
      };
    },

    create: async (signedIn, nonce) => {
      const { accountId } = signedIn;
      const refused = await manageBasis(accountId);
      if (refused !== undefined) return refused;
      const key = `${correctorKeyPrefix}${randomBytes(32).toString('base64url')}`;
      const keyId = randomUUID();
      const spent = await stepUp.spend(
        signedIn,
        'corrector_key',
        { ...createCorrectorKeyAction(), nonce },
        async (tx, { id: stepUpId }) => {
          await actAs(tx, accountId);
          // Recorded first, so a key no event records is never stored.
          await audit.record({
            code: 'corrector_key_created',
            subjectAccountId: accountId,
            actorAccountId: accountId,
            details: { keyId },
          });
          await tx.execute(sql`
            INSERT INTO knowledge.corrector_key (id, kind, key_sha256, actor_account_id, step_up_id)
            VALUES (${keyId}, 'created', ${sha256(key)}, ${accountId}, ${stepUpId})`);
        },
      );
      if (!spent) return 'step_up_required';
      await tellOwners();
      return { key, expiresAt: expiry(new Date()).toISOString() };
    },

    revoke: async (accountId, keyId) => {
      const refused = await manageBasis(accountId);
      if (refused !== undefined) return refused;
      const revoked = await withIdentity(db(), { accountId }, async (tx) => {
        const { rows } = await tx.execute<{ revoked: boolean }>(
          sql`SELECT knowledge.revoke_corrector_key(${keyId}::uuid, 'owner_list') AS revoked`,
        );
        if (rows[0]?.revoked !== true) return false;
        await audit.record({
          code: 'corrector_key_revoked',
          subjectAccountId: accountId,
          actorAccountId: accountId,
          details: { keyId },
        });
        return true;
      });
      if (!revoked) return 'not_found';
      await tellOwners();
      return 'revoked';
    },
  };

  const corrector: Corrector = {
    authenticate: async (authorization) => {
      const token = bearerToken(authorization);
      const live = await usableKey();
      const digest = sha256(token);
      const matches = timingSafeEqual(digest, live?.key_sha256 ?? noKeyDigest);
      if (live === undefined || !matches || !correctorKeyPattern.test(token)) return undefined;
      return { id: live.id, digest, creatorId: live.actor_account_id };
    },

    refused: async () => {
      await Promise.all(
        role.ownerList.map((ownerId) =>
          audit.record({
            code: 'corrector_key_refused',
            subjectAccountId: ownerId,
            actorAccountId: null,
            details: {},
          }),
        ),
      );
    },

    list: async (key) => {
      const requests = (await workable(key)).slice(0, correctorListLimit);
      await audit.record({
        code: 'corrector_requests_listed',
        subjectAccountId: key.creatorId,
        actorAccountId: null,
        details: { keyId: key.id, count: requests.length },
      });
      return { requests };
    },

    fileUrl: async (key, requestId, position) => {
      const listed = (await workable(key)).slice(0, correctorListLimit);
      if (!listed.some((request) => request.id === requestId)) {
        await refusedUse(key, requestId, 'not_found');
        return 'not_found';
      }
      const { rows } = await db().execute<{ pathname: string | null }>(sql`
        SELECT knowledge.corrector_file(${key.id}::uuid, ${key.digest}, ${requestId}::uuid,
          ${position}) AS pathname`);
      const pathname = rows[0]?.pathname ?? null;
      if (pathname === null) {
        await refusedUse(key, requestId, 'not_found');
        return 'not_found';
      }
      await audit.record({
        code: 'corrector_file_downloaded',
        subjectAccountId: key.creatorId,
        actorAccountId: null,
        details: { keyId: key.id, requestId, position },
      });
      return { url: await storage.downloadUrl(pathname) };
    },

    answer: async (key, requestId, answer) => {
      const outcome = await answerOnce(key, requestId, answer);
      if (outcome !== 'stored') await refusedUse(key, requestId, outcome);
      return outcome;
    },
  };

  /**
   * The route whose versions an answer is checked against: the request's own; for a request for a
   * new route, the route a proposed version names, which must be in the request's country, or
   * null when nothing is proposed. Undefined for a route the answer may not name.
   */
  function proposedRouteOf(
    request: WorkableRequest,
    answer: CorrectionAnswer,
  ): string | null | undefined {
    const named = answer.kind === 'version_proposed' ? answer.routeId : undefined;
    if (request.routeId !== null) {
      return named === undefined || named === request.routeId ? request.routeId : undefined;
    }
    if (answer.kind !== 'version_proposed') return null;
    const isFirstVersion = answer.number === 1;
    return isFirstVersion &&
      named !== undefined &&
      routeCountry(named) === request.countryCode?.toUpperCase()
      ? named
      : undefined;
  }

  /** Stores an answer the request's state and the catalog allow; audited inside its transaction. */
  async function answerOnce(
    key: PresentedKey,
    requestId: string,
    answer: CorrectionAnswer,
  ): Promise<AnswerOutcome> {
    const [listed, decided] = await Promise.all([workable(key), states()]);
    const request = listed.find(({ id }) => id === requestId);
    if (request === undefined) return 'not_found';
    const proposedRoute = proposedRouteOf(request, answer);
    if (proposedRoute === undefined) return 'invalid_version';
    const refusal = correctionAnswerRefusal({
      versionNumber: request.versionNumber,
      state: request.state,
      answer,
      identities: proposedRoute === null ? [] : versions.identities(proposedRoute),
      states: decided,
    });
    if (refusal !== undefined) return refusal === 'wrong_state' ? refusal : 'invalid_version';
    const proposed = answer.kind === 'version_proposed' ? answer.number : null;
    const explanation = answer.kind === 'no_change' ? answer.explanation : null;
    // Only a version proposed for a new route names its route, through a function of its own.
    const newRoute = request.countryCode !== null && answer.kind === 'version_proposed';
    const stored = await db().transaction(async (tx) => {
      const { rows } = await tx.execute<{ outcome: 'stored' | 'refused' | 'missing' }>(
        newRoute
          ? sql`SELECT knowledge.answer_route_request(${key.id}::uuid, ${key.digest},
              ${requestId}::uuid, ${proposedRoute}::text, ${proposed}::integer) AS outcome`
          : sql`SELECT knowledge.answer_correction_request(${key.id}::uuid, ${key.digest},
              ${requestId}::uuid, ${answer.kind === 'taken' ? 'taken' : 'answered'},
              ${proposed}::integer, ${explanation}::text) AS outcome`,
      );
      const outcome = rows[0]?.outcome ?? 'missing';
      if (outcome === 'stored') {
        // Recorded before the answer commits, so an answer no event records is never kept.
        await audit.record({
          code: 'correction_answered',
          subjectAccountId: key.creatorId,
          actorAccountId: null,
          details: { keyId: key.id, requestId, answer: answer.kind },
        });
      }
      return outcome;
    });
    if (stored === 'missing') return 'not_found';
    return stored === 'refused' ? 'wrong_state' : 'stored';
  }

  return { keys, corrector };
}
