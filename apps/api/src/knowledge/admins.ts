import { lockKey, type Database, type Transaction } from '@arca/db';
import { type SQL, sql } from 'drizzle-orm';

/** One row of the admin role's history (ADR-0027), as `knowledge.admin_grant` stores it. */
export interface AdminGrantRow {
  readonly id: string;
  readonly kind: 'grant' | 'removal';
  readonly granteeAccountId: string;
  readonly actorAccountId: string;
  readonly actorBasis: 'owner_list' | 'grant';
  readonly actorGrantId: string | null;
  readonly removesGrantId: string | null;
  /** Microseconds since the epoch, as the database keeps them; a `Date` would round to ms. */
  readonly at: bigint;
}

/** Why an account is an admin: the owner list, or the grant in force for it. */
export type AdminBasis =
  { readonly basis: 'owner_list' } | { readonly basis: 'grant'; readonly grantId: string };

/** What the history says about the role, from the rows that count. */
export interface AdminHistory {
  /** The grant in force for the account now, if any. */
  readonly liveGrant: (accountId: string) => string | undefined;
  /** Whether the grant counted and was in force for the account at that time. */
  readonly inForce: (grantId: string, accountId: string, at: bigint) => boolean;
}

interface Interval {
  readonly grantee: string;
  readonly from: bigint;
  to?: bigint;
}

/**
 * Replays the history in time order (ADR-0027). A row counts only when its actor was an admin at
 * its time: on the owner list by the basis it records, which app_auth checked when it stored the
 * row, or by the grant it names, in force for the actor then. So a row by an account that was never
 * an admin changes nothing, and a later row never changes what an earlier time saw.
 */
const byTime = (a: AdminGrantRow, b: AdminGrantRow): number => {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
};

export function adminHistory(rows: readonly AdminGrantRow[]): AdminHistory {
  const ordered = [...rows].sort(byTime);
  const live = new Map<string, string>();
  const intervals = new Map<string, Interval>();
  for (const row of ordered) {
    const actorWasAdmin =
      row.actorBasis === 'owner_list' ||
      (row.actorGrantId !== null && live.get(row.actorAccountId) === row.actorGrantId);
    if (!actorWasAdmin) continue;
    if (row.kind === 'grant') {
      if (live.has(row.granteeAccountId)) continue;
      live.set(row.granteeAccountId, row.id);
      intervals.set(row.id, { grantee: row.granteeAccountId, from: row.at });
    } else if (
      row.removesGrantId !== null &&
      live.get(row.granteeAccountId) === row.removesGrantId
    ) {
      live.delete(row.granteeAccountId);
      const interval = intervals.get(row.removesGrantId);
      if (interval !== undefined) interval.to = row.at;
    }
  }
  return {
    liveGrant: (accountId) => live.get(accountId),
    inForce: (grantId, accountId, at) => {
      const interval = intervals.get(grantId);
      if (interval?.grantee !== accountId) return false;
      return interval.from <= at && (interval.to === undefined || at < interval.to);
    },
  };
}

/** A timestamp column as microseconds since the epoch, in text, for a `bigint` in code. */
export const epochMicros = (column: unknown): SQL =>
  sql`(extract(epoch FROM ${column}) * 1000000)::bigint::text`;

interface StoredRow extends Record<string, unknown> {
  id: string;
  kind: string;
  grantee_account_id: string;
  actor_account_id: string;
  actor_basis: string;
  actor_grant_id: string | null;
  removes_grant_id: string | null;
  at: string;
}

function parsedRow(row: StoredRow): AdminGrantRow | undefined {
  const { kind, actor_basis: actorBasis } = row;
  if (kind !== 'grant' && kind !== 'removal') return undefined;
  if (actorBasis !== 'owner_list' && actorBasis !== 'grant') return undefined;
  return {
    id: row.id,
    kind,
    granteeAccountId: row.grantee_account_id,
    actorAccountId: row.actor_account_id,
    actorBasis,
    actorGrantId: row.actor_grant_id,
    removesGrantId: row.removes_grant_id,
    at: BigInt(row.at),
  };
}

/** The whole history, small by nature: one row per change of the role. */
export async function readAdminHistory(db: Database | Transaction): Promise<AdminHistory> {
  const { rows } = await db.execute<StoredRow>(sql`
    SELECT id, kind, grantee_account_id, actor_account_id, actor_basis, actor_grant_id,
           removes_grant_id, ${epochMicros(sql.raw('at'))} AS at
      FROM knowledge.admin_grant`);
  return adminHistory(rows.map(parsedRow).filter((row) => row !== undefined));
}

/**
 * Takes the advisory lock of each account whose role a transaction reads or changes, in one fixed
 * order, so a decision and a change of its author's role, or two changes, never interleave.
 */
export async function lockAdmins(tx: Transaction, accountIds: readonly string[]): Promise<void> {
  for (const accountId of [...new Set(accountIds)].sort()) {
    await lockKey(tx, `knowledge.admin:${accountId}`);
  }
}

/** Why an account was an admin, as a stored row records it. */
export interface StoredBasis {
  readonly basis: AdminBasis['basis'];
  readonly grantId: string | null;
}

/** Who is an admin (ADR-0027): the owner list, then the history, read on every call. */
export interface AdminRole {
  readonly ownerList: readonly string[];
  readonly isOwner: (accountId: string) => boolean;
  /** Read on the app_api pool, never cached, so taking the role away takes effect at once. */
  readonly isAdmin: (accountId: string) => Promise<boolean>;
  /** Why the account is an admin, by the owner list and a history already read. */
  readonly basisOf: (history: AdminHistory, accountId: string) => AdminBasis | undefined;
  /**
   * In a transaction that is about to store a row: the locks on the actor and the other accounts
   * the row names, then the history and why the actor is an admin. Undefined for a non-admin.
   */
  readonly held: (
    tx: Transaction,
    actorId: string,
    others?: readonly string[],
  ) => Promise<{ readonly basis: StoredBasis; readonly history: AdminHistory } | undefined>;
}

export function adminRole(db: () => Database, ownerList: readonly string[]): AdminRole {
  const owners = new Set(ownerList);
  const basisOf = (history: AdminHistory, accountId: string): AdminBasis | undefined => {
    if (owners.has(accountId)) return { basis: 'owner_list' };
    const grantId = history.liveGrant(accountId);
    return grantId === undefined ? undefined : { basis: 'grant', grantId };
  };
  return {
    ownerList,
    isOwner: (accountId) => owners.has(accountId),
    isAdmin: async (accountId) =>
      owners.has(accountId) || basisOf(await readAdminHistory(db()), accountId) !== undefined,
    basisOf,
    held: async (tx, actorId, others = []) => {
      await lockAdmins(tx, [actorId, ...others]);
      const history = await readAdminHistory(tx);
      const held = basisOf(history, actorId);
      if (held === undefined) return undefined;
      const grantId = held.basis === 'grant' ? held.grantId : null;
      return { basis: { basis: held.basis, grantId }, history };
    },
  };
}
