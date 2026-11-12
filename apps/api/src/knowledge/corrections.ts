import type {
  CorrectionFileType,
  CorrectionItem,
  CorrectionRequests,
  DocumentUploadUrlResponse,
  FileCorrectionRequest,
  ListedCorrectionSource,
  StartCorrectionUpload,
  StartCorrectionUploadResponse,
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
import type { ObjectStorage } from '../vault/object-storage.js';
import { fitsFileType } from './correction-files.js';
import type { KnowledgeVersions } from './versions.js';

type FilingRefusal = 'not_admin' | 'owner_list_only';

export type FileOutcome =
  | { readonly id: string }
  | FilingRefusal
  | 'not_found'
  | 'already_corrected'
  | 'not_uploaded'
  | 'upload_mismatch';

/** An upload is presigned only this long after it started, so every grant ends before the cleanup. */
export const correctionUploadWindowMinutes = 60;

/** A file is named by a request only this long after its upload started. */
export const correctionFilingWindowHours = 2;

/** Correction requests as the API serves them (ADR-0029), through the definer functions only. */
export interface Corrections {
  readonly file: (accountId: string, request: FileCorrectionRequest) => Promise<FileOutcome>;
  readonly list: (
    accountId: string,
    routeId: string,
    number: number,
  ) => Promise<CorrectionRequests | 'not_admin' | 'not_found'>;
  readonly close: (accountId: string, id: string) => Promise<'closed' | 'not_admin' | 'not_found'>;
  /** Starts the upload of one file, for an owner-list admin. */
  readonly startUpload: (
    accountId: string,
    upload: StartCorrectionUpload,
  ) => Promise<StartCorrectionUploadResponse | FilingRefusal>;
  /** The presigned upload for the admin's own unused upload at this pathname, within the hour. */
  readonly presignUpload: (
    accountId: string,
    pathname: string,
  ) => Promise<DocumentUploadUrlResponse | FilingRefusal | 'not_found'>;
  /** A 5-minute download URL for one file source, for an admin. */
  readonly fileUrl: (
    accountId: string,
    requestId: string,
    position: number,
  ) => Promise<{ readonly url: string } | 'not_admin' | 'not_found'>;
}

export interface CorrectionSettings {
  /** The app_api pool, which may only execute the definer functions on the request tables. */
  readonly db: () => Database;
  readonly role: AdminRole;
  readonly versions: Pick<KnowledgeVersions, 'view' | 'identities'>;
  readonly states: () => Promise<DecisionStates>;
  readonly audit: Pick<AuditLog, 'record'>;
  readonly notify: AccountNotice<'correction_requested'>;
  /** The environment's object store, where request files live under `corrections/`. */
  readonly storage: ObjectStorage;
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
  note: string | null;
  created_at: string | Date;
  /** A file source comes as its kind only; `correction_files` gives its type and size. */
  sources: (ListedCorrectionSource | { kind: 'file' })[];
  /** This slice stores only an admin's close. */
  events: Extract<CorrectionEvent, { kind: 'closed' }>[];
}

interface StoredFile extends Record<string, unknown> {
  request_id: string;
  position: number;
  media_type: CorrectionFileType;
  size: number;
}

export function createCorrections({
  db,
  role,
  versions,
  states,
  audit,
  notify,
  storage,
}: CorrectionSettings): Corrections {
  const basisOf = async (accountId: string) =>
    role.basisOf(await readAdminHistory(db()), accountId);

  /** The basis of an admin who may file: the owner list, which lives in code. */
  const filingBasis = async (accountId: string) => {
    const basis = await basisOf(accountId);
    if (basis === undefined) return 'not_admin';
    return basis.basis === 'owner_list' ? basis : 'owner_list_only';
  };

  /** The account's own upload no request names, by ID or pathname, started within `minutes`. */
  const ownUpload = async (
    accountId: string,
    by: { readonly id: string } | { readonly pathname: string },
    minutes: number,
  ) => {
    const [found] = await withIdentity(db(), { accountId }, async (tx) => {
      const id = 'id' in by ? by.id : null;
      const pathname = 'pathname' in by ? by.pathname : null;
      const { rows } = await tx.execute<{
        pathname: string;
        media_type: CorrectionFileType;
        size: number;
        sha256: Buffer;
        created_at: string | Date;
      }>(sql`
        SELECT pathname, media_type, size, sha256, created_at
          FROM knowledge.own_correction_upload(${id}::uuid, ${pathname}::text)`);
      return rows;
    });
    const started = found === undefined ? 0 : new Date(found.created_at).getTime();
    return started > Date.now() - minutes * 60_000 ? found : undefined;
  };

  /**
   * Checks each file source against its upload: stored, with the declared size and SHA-256, and
   * of the declared type by its first bytes. A file that differs is deleted; its upload stays
   * until the daily cleanup.
   */
  const checkFiles = async (
    accountId: string,
    sources: FileCorrectionRequest['sources'],
  ): Promise<'not_found' | 'not_uploaded' | 'upload_mismatch' | undefined> => {
    for (const source of sources) {
      if (source.kind !== 'file') continue;
      const upload = await ownUpload(
        accountId,
        { id: source.uploadId },
        correctionFilingWindowHours * 60,
      );
      if (upload === undefined) return 'not_found';
      const stored = await storage.digest(upload.pathname);
      if (stored === undefined) return 'not_uploaded';
      if (
        stored.size !== upload.size ||
        !stored.sha256.equals(upload.sha256) ||
        !fitsFileType(upload.media_type, stored.head)
      ) {
        await audit.record({
          code: 'correction_upload_mismatch',
          subjectAccountId: accountId,
          actorAccountId: accountId,
          details: { uploadId: source.uploadId },
        });
        await storage.delete([upload.pathname]);
        return 'upload_mismatch';
      }
    }
    return undefined;
  };

  return {
    file: async (accountId, request) => {
      const basis = await filingBasis(accountId);
      if (typeof basis === 'string') return basis;
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
      const refused = await checkFiles(accountId, request.sources);
      if (refused !== undefined) return refused;
      // Links and texts first, through the #414 function; files after them, in the same transaction.
      const written = request.sources.filter((source) => source.kind !== 'file');
      const files = request.sources.filter((source) => source.kind === 'file');
      const id = await withIdentity(db(), { accountId }, async (tx) => {
        const { rows } = await tx.execute<{ id: string }>(sql`
          SELECT knowledge.file_correction_request(${request.routeId}, ${request.versionNumber},
            ${request.item.kind}, ${request.item.key}, ${request.note},
            ${JSON.stringify(written)}::jsonb, ${basis.basis}) AS id`);
        const filed = rows[0]?.id;
        if (filed === undefined) throw new Error('The request was not filed');
        for (const [index, file] of files.entries()) {
          await tx.execute(sql`
            SELECT knowledge.attach_correction_file(${filed}, ${written.length + index},
              ${file.uploadId}, ${basis.basis})`);
        }
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
      const [{ rows, files }, decided] = await Promise.all([
        withIdentity(db(), { accountId }, async (tx) => ({
          rows: (
            await tx.execute<StoredRequest>(sql`
              SELECT * FROM knowledge.correction_requests(${routeId}, ${number}, ${kind}, ${grantId})`)
          ).rows,
          files: (
            await tx.execute<StoredFile>(sql`
              SELECT * FROM knowledge.correction_files(${routeId}, ${number}, ${kind}, ${grantId})`)
          ).rows,
        })),
        states(),
      ]);
      const fileAt = new Map(
        files.map((file) => [
          `${file.request_id}/${String(file.position)}`,
          { kind: 'file' as const, mediaType: file.media_type, size: file.size },
        ]),
      );
      return {
        canFile: basis.basis === 'owner_list',
        requests: rows.map((row) => ({
          id: row.id,
          item: { kind: row.item_kind, key: row.item_key },
          note: row.note,
          createdAt: new Date(row.created_at).toISOString(),
          sources: row.sources.flatMap((source, position) => {
            if (!('mediaType' in source) && source.kind === 'file') {
              const file = fileAt.get(`${row.id}/${String(position)}`);
              return file === undefined ? [] : [file];
            }
            return [source];
          }),
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

    startUpload: async (accountId, { mediaType, size, sha256 }) => {
      const basis = await filingBasis(accountId);
      if (typeof basis === 'string') return basis;
      const started = await withIdentity(db(), { accountId }, async (tx) => {
        const { rows } = await tx.execute<{ id: string; pathname: string }>(sql`
          SELECT id, pathname FROM knowledge.start_correction_upload(${mediaType}, ${size},
            ${Buffer.from(sha256, 'base64url')}, ${basis.basis})`);
        return rows[0];
      });
      if (started === undefined) throw new Error('The upload was not started');
      return { uploadId: started.id, upload: storage.uploadTarget(started.pathname, size) };
    },

    presignUpload: async (accountId, pathname) => {
      const basis = await filingBasis(accountId);
      if (typeof basis === 'string') return basis;
      const upload = await ownUpload(accountId, { pathname }, correctionUploadWindowMinutes);
      return upload === undefined
        ? 'not_found'
        : storage.presignUpload(pathname, upload.size, upload.media_type);
    },

    fileUrl: async (accountId, requestId, position) => {
      const basis = await basisOf(accountId);
      if (basis === undefined) return 'not_admin';
      const { basis: kind, grantId } = basisArguments(basis);
      const pathname = await withIdentity(db(), { accountId }, async (tx) => {
        const { rows } = await tx.execute<{ pathname: string | null }>(sql`
          SELECT knowledge.correction_file(${requestId}, ${position}, ${kind}, ${grantId}) AS pathname`);
        return rows[0]?.pathname ?? null;
      });
      if (pathname === null) return 'not_found';
      await audit.record({
        code: 'correction_file_downloaded',
        subjectAccountId: accountId,
        actorAccountId: accountId,
        details: { requestId, position },
      });
      return { url: await storage.downloadUrl(pathname) };
    },
  };
}
