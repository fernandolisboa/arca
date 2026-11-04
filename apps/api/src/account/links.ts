import { withIdentity, type Database } from '@arca/db';
import { sql } from 'drizzle-orm';

/**
 * Records the link between an inviter and the account it confirmed (spec 0005, R4), as `app_api`
 * under the inviter's identity: only the inviter may add it. A retry adds nothing.
 */
export function linkAccounts(apiDb: Database) {
  return (inviterId: string, inviteeId: string): Promise<void> =>
    withIdentity(apiDb, { accountId: inviterId }, async (tx) => {
      // Raw SQL: app_api may insert only these columns, and Drizzle would list them all.
      await tx.execute(sql`
        INSERT INTO account.link (inviter_id, invitee_id) VALUES (${inviterId}, ${inviteeId})
        ON CONFLICT DO NOTHING`);
    });
}
