import type {
  CorrectionItem,
  CorrectionRequests,
  CorrectionSource,
  FileCorrectionRequest,
} from '@arca/api-contract/routes';
import { type Database, withIdentity } from '@arca/db';
import {
  type CorrectionEvent,
  type DecisionStates,
  type VersionView,
  correctionState,
  correctionTargets,
} from '@arca/domain';
import { sql } from 'drizzle-orm';
import type { AccountNotice } from '../auth/account-notices.js';
import type { AuditLog } from '../audit/log.js';
import { type AdminBasis, type AdminRole, readAdminHistory } from './admins.js';
import type { KnowledgeVersions } from './versions.js';

export type FileOutcome =
  { readonly id: string } | 'not_admin' | 'owner_list_only' | 'not_found' | 'already_corrected';

/** Correction requests as the API serves them (ADR-0029), through the definer functions only. */
export interface Corrections {
  readonly file: (accountId: string, request: FileCorrectionRequest) => Promise<FileOutcome>;
  readonly list: (
    accountId: string,
    routeId: string,
    number: number,
  ) => Promise<CorrectionRequests | 'not_admin' | 'not_found'>;
  readonly close: (accountId: string, id: string) => Promise<'closed' | 'not_admin' | 'not_found'>;
}

export interface CorrectionSettings {
  /** The app_api pool, which may only execute the definer functions on the request tables. */
  readonly db: () => Database;
  readonly role: AdminRole;
  readonly versions: Pick<KnowledgeVersions, 'view' | 'identities'>;
  readonly states: () => Promise<DecisionStates>;
  readonly audit: Pick<AuditLog, 'record'>;
  readonly notify: AccountNotice<'correction_requested'>;
}

function holdsItem(view: VersionView, { kind, key }: CorrectionItem): boolean {
  if (kind === 'version' || kind === 'settings') return key === null;
  return correctionTargets(view)[kind].some((target) => target.key === key);
}

/** The basis as the definer functions take it: the owner list, or the grant it names. */
const basisArguments = (basis: AdminBasis) =>
  basis.basis === 'grant'
    ? { basis: 'grant', grantId: basis.grantId }
    : { basis: 'owner_list', grantId: null };

interface StoredRequest extends Record<string, unknown> {
  id: string;
  item_kind: CorrectionItem['kind'];
  item_key: string | null;
  note: string;
  created_at: string | Date;
  sources: CorrectionSource[];
  /** This slice stores only an admin's close. */
  events: Extract<CorrectionEvent, { kind: 'closed' }>[];
}

export function createCorrections({
  db,
  role,
  versions,
  states,
  audit,
  notify,
}: CorrectionSettings): Corrections {
  const basisOf = async (accountId: string) =>
    role.basisOf(await readAdminHistory(db()), accountId);

  return {
    file: async (accountId, request) => {
      const basis = await basisOf(accountId);
      if (basis === undefined) return 'not_admin';
      if (basis.basis !== 'owner_list') return 'owner_list_only';
      const view = await versions.view(request.routeId, request.versionNumber);
      if (view === undefined || !holdsItem(view, request.item)) return 'not_found';
      // A request filed after a correction is active would close at once and never be worked on.
      const corrected = correctionState({
        versionNumber: request.versionNumber,
        events: [],
        identities: versions.identities(request.routeId),
        states: await states(),
      });
      if (corrected === 'closed') return 'already_corrected';
      const id = await withIdentity(db(), { accountId }, async (tx) => {
        const { rows } = await tx.execute<{ id: string }>(sql`
          SELECT knowledge.file_correction_request(${request.routeId}, ${request.versionNumber},
            ${request.item.kind}, ${request.item.key}, ${request.note},
            ${JSON.stringify(request.sources)}::jsonb, ${basis.basis}) AS id`);
        const filed = rows[0]?.id;
        if (filed === undefined) throw new Error('The request was not filed');
        // Recorded before the filing commits, so a request no event records is never kept.
        await audit.record({
          code: 'correction_requested',
          subjectAccountId: accountId,
          actorAccountId: accountId,
          details: { requestId: filed, routeId: request.routeId, number: request.versionNumber },
        });
        return filed;
      });
      await Promise.all(role.ownerList.map((ownerId) => notify(ownerId, 'correction_requested')));
      return { id };
    },

    list: async (accountId, routeId, number) => {
      const basis = await basisOf(accountId);
      if (basis === undefined) return 'not_admin';
      const identities = versions.identities(routeId);
      if (!identities.some((identity) => identity.number === number)) return 'not_found';
      const { basis: kind, grantId } = basisArguments(basis);
      const [rows, decided] = await Promise.all([
        withIdentity(db(), { accountId }, async (tx) => {
          const result = await tx.execute<StoredRequest>(sql`
            SELECT * FROM knowledge.correction_requests(${routeId}, ${number}, ${kind}, ${grantId})`);
          return result.rows;
        }),
        states(),
      ]);
      return {
        canFile: basis.basis === 'owner_list',
        requests: rows.map((row) => ({
          id: row.id,
          item: { kind: row.item_kind, key: row.item_key },
          note: row.note,
          createdAt: new Date(row.created_at).toISOString(),
          sources: row.sources,
          state: correctionState({
            versionNumber: number,
            events: row.events,
            identities,
            states: decided,
          }),
        })),
      };
    },

    close: async (accountId, id) => {
      const basis = await basisOf(accountId);
      if (basis === undefined) return 'not_admin';
      const { basis: kind, grantId } = basisArguments(basis);
      const outcome = await withIdentity(db(), { accountId }, async (tx) => {
        const { rows } = await tx.execute<{ outcome: 'closed' | 'unchanged' | 'missing' }>(
          sql`SELECT knowledge.close_correction_request(${id}, ${kind}, ${grantId}) AS outcome`,
        );
        const closed = rows[0]?.outcome ?? 'missing';
        if (closed === 'closed') {
          await audit.record({
            code: 'correction_closed',
            subjectAccountId: accountId,
            actorAccountId: accountId,
            details: { requestId: id },
          });
        }
        return closed;
      });
      return outcome === 'missing' ? 'not_found' : 'closed';
    },
  };
}
