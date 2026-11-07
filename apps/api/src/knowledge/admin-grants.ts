import { randomUUID } from 'node:crypto';
import { grantAdminAction, type CaseAdmin } from '@arca/api-contract/routes';
import { actAs, type Database, type Transaction, withIdentity } from '@arca/db';
import { sql } from 'drizzle-orm';
import type { AccountNotice } from '../auth/account-notices.js';
import { accounts } from '../auth/auth.js';
import type { SignedIn } from '../auth/service.js';
import type { StepUpSpender } from '../auth/step-up.js';
import type { AuditLog } from '../audit/log.js';
import { type AdminRole, readAdminHistory } from './admins.js';

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
}

/** A grant refused inside the step-up's transaction, so the step-up stays unspent. */
class Refused extends Error {
  readonly outcome: 'not_admin' | 'not_found' | 'unchanged';
  constructor(outcome: 'not_admin' | 'not_found' | 'unchanged') {
    super(outcome);
    this.outcome = outcome;
  }
}

/** One change of the role: the admin who makes it and the account whose role changes. */
interface Change {
  readonly actorId: string;
  readonly granteeId: string;
}

export function createAdminGrants({
  db,
  authDb,
  role,
  stepUp,
  audit,
  notify,
}: AdminGrantSettings): AdminGrants {
  /** The accounts of the actor's case; row-level security scopes the read as well. */
  const caseAccounts = (actorId: string) =>
    withIdentity(db(), { accountId: actorId }, async (tx) => {
      const { rows } = await tx.execute<{ account_id: string }>(sql`
        SELECT account_id FROM cases.member
         WHERE case_id IN (SELECT case_id FROM cases.member WHERE account_id = ${actorId})
         ORDER BY account_id`);
      return rows.map((row) => row.account_id);
    });

  /** Whether the account shares the actor's case; false alike for unknown and outside accounts. */
  const inCase = async ({ actorId, granteeId }: Change) =>
    (await caseAccounts(actorId)).includes(granteeId);

  /**
   * The change's audit events, recorded first on app_audit so a change no event records is never
   * stored: one for the admin who made it and one for the account it names.
   */
  const recordChange = async (
    code: 'admin_granted' | 'admin_removed',
    { actorId, granteeId }: Change,
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
    Promise.all(role.ownerList.map((ownerId) => notify(ownerId, 'admin_role_changed')));

  const grantIn = async (tx: Transaction, change: Change, stepUpId: string) => {
    const { actorId, granteeId } = change;
    await actAs(tx, actorId);
    const held = await role.held(tx, actorId, [granteeId]);
    if (held === undefined) throw new Refused('not_admin');
    if (!(await accounts.isConfirmed(tx, granteeId))) throw new Refused('not_found');
    if (role.basisOf(held.history, granteeId) !== undefined) throw new Refused('unchanged');
    const id = randomUUID();
    const { basis, grantId } = held.basis;
    await recordChange('admin_granted', change, id);
    await tx.execute(sql`
      INSERT INTO knowledge.admin_grant (id, kind, grantee_account_id, actor_account_id,
        actor_basis, actor_grant_id, step_up_id)
      VALUES (${id}, 'grant', ${granteeId}, ${actorId}, ${basis}, ${grantId}, ${stepUpId})`);
  };

  const removeIn = async (change: Change) =>
    withIdentity(authDb(), { accountId: change.actorId }, async (tx) => {
      const { actorId, granteeId } = change;
      const held = await role.held(tx, actorId, [granteeId]);
      if (held === undefined) return 'not_admin' as const;
      const removed = held.history.liveGrant(granteeId);
      if (removed === undefined) return 'unchanged' as const;
      const id = randomUUID();
      const { basis, grantId } = held.basis;
      await recordChange('admin_removed', change, id);
      await tx.execute(sql`
        INSERT INTO knowledge.admin_grant (id, kind, grantee_account_id, actor_account_id,
          actor_basis, actor_grant_id, removes_grant_id)
        VALUES (${id}, 'removal', ${granteeId}, ${actorId}, ${basis}, ${grantId}, ${removed})`);
      return 'changed' as const;
    });

  /** The history as app_api reads it now, for the checks made before a transaction. */
  const currentHistory = () => readAdminHistory(db());

  return {
    isAdmin: role.isAdmin,

    list: async (accountId) => {
      const history = await currentHistory();
      if (role.basisOf(history, accountId) === undefined) return 'not_admin';
      const members = await caseAccounts(accountId);
      if (members.length === 0) return 'not_found';
      return members.flatMap((member) =>
        role.basisOf(history, member) === undefined
          ? []
          : [{ accountId: member, onOwnerList: role.isOwner(member) }],
      );
    },

    grant: async (signedIn, granteeId, nonce) => {
      const change = { actorId: signedIn.accountId, granteeId };
      const history = await currentHistory();
      if (role.basisOf(history, change.actorId) === undefined) return 'not_admin';
      // Checked before the grantee's role, so an account outside the case learns nothing.
      if (!(await inCase(change))) return 'not_found';
      if (role.basisOf(history, granteeId) !== undefined) return 'unchanged';
      try {
        const spent = await stepUp.spend(
          signedIn,
          'admin_grant',
          { ...grantAdminAction({ accountId: granteeId }), nonce },
          (tx, { id }) => grantIn(tx, change, id),
        );
        if (!spent) return 'step_up_required';
      } catch (error) {
        if (error instanceof Refused) return error.outcome;
        throw error;
      }
      await tellOwners();
      return 'changed';
    },

    remove: async ({ accountId: actorId }, granteeId) => {
      const change = { actorId, granteeId };
      if (role.basisOf(await currentHistory(), actorId) === undefined) return 'not_admin';
      if (!(await inCase(change))) return 'not_found';
      if (role.isOwner(granteeId)) return 'owner_list_admin';
      const outcome = await removeIn(change);
      if (outcome === 'changed') await tellOwners();
      return outcome;
    },
  };
}
