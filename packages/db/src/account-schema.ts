import { sql, type SQL } from 'drizzle-orm';
import { check, index, pgPolicy, pgSchema, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Links between accounts (spec 0005, R4): the inviter and the invitee of a confirmed invite. A
 * link is the only way one account reads another's public vault recipient, to share with it.
 * No foreign key reaches the auth schema; erasure removes the row for either party through the
 * registry.
 */
export const account = pgSchema('account');

const identity = (column: unknown): SQL =>
  sql`${column} = nullif(current_setting('app.account_id', true), '')::uuid`;

export const link = account.table(
  'link',
  {
    inviterId: uuid('inviter_id').notNull(),
    inviteeId: uuid('invitee_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'link_pkey', columns: [table.inviterId, table.inviteeId] }),
    check('link_two_accounts', sql`${table.inviterId} <> ${table.inviteeId}`),
    index('link_invitee_id_idx').on(table.inviteeId),
    pgPolicy('link_select_party', {
      for: 'select',
      to: 'app_api',
      using: sql`${identity(table.inviterId)} OR ${identity(table.inviteeId)}`,
    }),
    pgPolicy('link_insert_inviter', {
      for: 'insert',
      to: 'app_api',
      withCheck: identity(table.inviterId),
    }),
    pgPolicy('link_delete_party', {
      for: 'delete',
      to: 'app_api',
      using: sql`${identity(table.inviterId)} OR ${identity(table.inviteeId)}`,
    }),
    // One policy per column: the registry guard checks each erase policy holds only on the identity.
    pgPolicy('link_select_inviter_by_jobs', {
      for: 'select',
      to: 'app_jobs',
      using: identity(table.inviterId),
    }),
    pgPolicy('link_select_invitee_by_jobs', {
      for: 'select',
      to: 'app_jobs',
      using: identity(table.inviteeId),
    }),
    pgPolicy('link_delete_inviter_by_jobs', {
      for: 'delete',
      to: 'app_jobs',
      using: identity(table.inviterId),
    }),
    pgPolicy('link_delete_invitee_by_jobs', {
      for: 'delete',
      to: 'app_jobs',
      using: identity(table.inviteeId),
    }),
  ],
);
