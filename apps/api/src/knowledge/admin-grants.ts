import { randomUUID } from 'node:crypto';
import { grantAdminAction, type CaseAdmin } from '@arca/api-contract/routes';
import { actAs, type Database, type Transaction, withIdentity } from '@arca/db';
import { sql } from 'drizzle-orm';
import type { AccountNotice } from '../auth/account-notices.js';
import { accounts } from '../auth/auth.js';
import type { SignedIn } from '../auth/service.js';
import type { StepUpSpender } from '../auth/step-up.js';
import type { AuditLog } from '../audit/log.js';
import { type AdminBasis, type AdminRole, lockAdmins, readAdminHistory } from './admins.js';

/** `unchanged`: the account already was, or already was not, an admin; nothing is stored. */
export type AdminChangeOutcome =
  'changed' | 'unchanged' | 'not_admin' | 'not_found' | 'owner_list_admin' | 'step_up_required';

export interface AdminGrants {
  readonly isAdmin: (accountId: string) => Promise<boolean>;
  /** The admins among the admin's case members; refused for anyone else or outside a case. */
  readonly list: (accountId: string) => Promise<readonly CaseAdmin[] | 'not_admin' | 'not_found'>;
  /** Gives the role, spending the session's `admin_grant` step-up bound to the grantee. */
  readonly grant: (
    signedIn: SignedIn,
    granteeId: string,
    nonce: Uint8Array,
  ) => Promise<AdminChangeOutcome>;
  /** Takes the role away, with no step-up. */
  readonly remove: (signedIn: SignedIn, granteeId: string) => Promise<AdminChangeOutcome>;
}

export interface AdminGrantSettings {
  /** The app_api pool, which reads case membership under row-level security. */
  readonly db: () => Database;
  /** The app_auth pool, the only role that stores a change of the role. */
  readonly authDb: () => Database;
  readonly role: AdminRole;
  /** Spends the step-up on the app_auth pool, in the transaction that stores the grant. */
  readonly stepUp: StepUpSpender;
  readonly audit: Pick<AuditLog, 'record'>;
  readonly notify: AccountNotice<'admin_role_changed'>;
  readonly ownerList: readonly string[];
}

class Refused extends Error {
  readonly outcome: 'not_admin' | 'not_found';
  constructor(outcome: 'not_admin' | 'not_found') {
    super(outcome);
    this.outcome = outcome;
  }
}

/** The columns that record why the actor was an admin. */
const basisColumns = (held: AdminBasis) =>
  held.basis === 'grant'
    ? { basis: held.basis, grantId: held.grantId }
    : { basis: held.basis, grantId: null };

export function createAdminGrants({
  db,
  authDb,
  role,
  stepUp,
  audit,
  notify,
  ownerList,
}: AdminGrantSettings): AdminGrants {
  /** The accounts of the actor's case, as row-level security lets the actor see them. */
  const caseAccounts = (actorId: string) =>
    withIdentity(db(), { accountId: actorId }, async (tx) => {
      const { rows } = await tx.execute<{ account_id: string }>(
        sql`SELECT account_id FROM cases.member ORDER BY account_id`,
      );
      return rows.map((row) => row.account_id);
    });

  /** Whether the account shares the actor's case; false alike for unknown and outside accounts. */
  const inCase = async (actorId: string, accountId: string) =>
    (await caseAccounts(actorId)).includes(accountId);

  /**
   * The change's audit events, recorded first on app_audit so a change no event records is never
   * stored: one for the admin who made it and one for the account it names.
   */
  const recordChange = async (
    code: 'admin_granted' | 'admin_removed',
    actorId: string,
    granteeId: string,
    grantId: string,
  ) => {
    for (const subjectAccountId of [actorId, granteeId]) {
      await audit.record({
        code,
        subjectAccountId,
        actorAccountId: actorId,
        details: { grantId, accountId: granteeId },
      });
    }
  };

  /** Every owner-list admin hears of a change, with a generic notice and no names. */
  const tellOwners = () =>
    Promise.all(ownerList.map((ownerId) => notify(ownerId, 'admin_role_changed')));

  /**
   * In an app_auth transaction under the actor's identity: the locks on both accounts, then the
   * actor's role. Undefined when the actor is no longer an admin.
   */
  const actorBasis = async (tx: Transaction, actorId: string, granteeId: string) => {
    await lockAdmins(tx, [actorId, granteeId]);
    const history = await readAdminHistory(tx);
    const basis = role.basisOf(history, actorId);
    return basis === undefined ? undefined : { basis, history };
  };

  const grantIn = async (tx: Transaction, actorId: string, granteeId: string, stepUpId: string) => {
    await actAs(tx, actorId);
    const held = await actorBasis(tx, actorId, granteeId);
    if (held === undefined) throw new Refused('not_admin');
    if (!(await accounts.isConfirmed(tx, granteeId))) throw new Refused('not_found');
    if (role.basisOf(held.history, granteeId) !== undefined) return 'unchanged' as const;
    const id = randomUUID();
    const { basis, grantId } = basisColumns(held.basis);
    await recordChange('admin_granted', actorId, granteeId, id);
    await tx.execute(sql`
      INSERT INTO knowledge.admin_grant (id, kind, grantee_account_id, actor_account_id,
        actor_basis, actor_grant_id, step_up_id)
      VALUES (${id}, 'grant', ${granteeId}, ${actorId}, ${basis}, ${grantId}, ${stepUpId})`);
    return 'changed' as const;
  };

  const removeIn = async (actorId: string, granteeId: string) =>
    withIdentity(authDb(), { accountId: actorId }, async (tx) => {
      const held = await actorBasis(tx, actorId, granteeId);
      if (held === undefined) return 'not_admin' as const;
      const removed = held.history.liveGrant(granteeId);
      if (removed === undefined) return 'unchanged' as const;
      const id = randomUUID();
      const { basis, grantId } = basisColumns(held.basis);
      await recordChange('admin_removed', actorId, granteeId, id);
      await tx.execute(sql`
        INSERT INTO knowledge.admin_grant (id, kind, grantee_account_id, actor_account_id,
          actor_basis, actor_grant_id, removes_grant_id)
        VALUES (${id}, 'removal', ${granteeId}, ${actorId}, ${basis}, ${grantId}, ${removed})`);
      return 'changed' as const;
    });

  return {
    isAdmin: role.isAdmin,

    list: async (accountId) => {
      if (!(await role.isAdmin(accountId))) return 'not_admin';
      const members = await caseAccounts(accountId);
      if (members.length === 0) return 'not_found';
      const flags = await Promise.all(members.map((member) => role.isAdmin(member)));
      return members.flatMap((member, index) =>
        flags[index] === true ? [{ accountId: member, owner: role.isOwner(member) }] : [],
      );
    },

    grant: async (signedIn, granteeId, nonce) => {
      const { accountId: actorId } = signedIn;
      if (!(await role.isAdmin(actorId))) return 'not_admin';
      // Checked before the grantee's role, so an account outside the case learns nothing.
      if (!(await inCase(actorId, granteeId))) return 'not_found';
      if (await role.isAdmin(granteeId)) return 'unchanged';
      const stored: { outcome?: 'changed' | 'unchanged' } = {};
      try {
        const spent = await stepUp.spend(
          signedIn,
          'admin_grant',
          { ...grantAdminAction({ accountId: granteeId }), nonce },
          async (tx, { id }) => {
            stored.outcome = await grantIn(tx, actorId, granteeId, id);
          },
        );
        if (!spent || stored.outcome === undefined) return 'step_up_required';
      } catch (error) {
        if (error instanceof Refused) return error.outcome;
        throw error;
      }
      if (stored.outcome === 'changed') await tellOwners();
      return stored.outcome;
    },

    remove: async ({ accountId: actorId }, granteeId) => {
      if (!(await role.isAdmin(actorId))) return 'not_admin';
      if (!(await inCase(actorId, granteeId))) return 'not_found';
      if (role.isOwner(granteeId)) return 'owner_list_admin';
      const outcome = await removeIn(actorId, granteeId);
      if (outcome === 'changed') await tellOwners();
      return outcome;
    },
  };
}
