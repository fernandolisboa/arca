import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/runner.ts';
import { definerRoles, retiredRoles, runtimeRoles } from '../../src/db/policy.ts';
import {
  adminTarget,
  containerPolicy,
  dropDatabase,
  freshDatabase,
  migratorTarget,
  realMigrations,
  roleTarget,
  withClient,
} from './support.ts';

/**
 * The case schema's access matrix (spec 0007, R1): people and relationships to the case's
 * members, profiles and finances to the keeper and whom it shared them with, writes only by the
 * keeper, and erasure confined to the identity. Synthetic people only.
 */
let database: string;

const tables = [
  'asset',
  'asset_owner',
  'case_file',
  'dependence',
  'member',
  'person',
  'person_finances',
  'person_profile',
  'relationship',
  'share',
] as const;

interface Family {
  readonly caseId: string;
  readonly otherCaseId: string;
  /** Alice, Bruno (same case) and Diana (another case). */
  readonly alice: string;
  readonly bruno: string;
  readonly diana: string;
  readonly people: {
    readonly alice: string;
    readonly bruno: string;
    readonly child: string;
    readonly grandparent: string;
    readonly diana: string;
  };
  /** Shared by Alice and Bruno; Alice's alone; Alice's, with Bruno named as a pending co-owner. */
  readonly assets: { readonly joint: string; readonly own: string; readonly proposed: string };
}

/**
 * Alice keeps herself and a child and shares the child's profile with Bruno; Bruno keeps himself
 * and his parent, a relative outside the case. Diana is alone in another case.
 */
async function seedFamily(): Promise<Family> {
  const family: Family = {
    caseId: randomUUID(),
    otherCaseId: randomUUID(),
    alice: randomUUID(),
    bruno: randomUUID(),
    diana: randomUUID(),
    people: {
      alice: randomUUID(),
      bruno: randomUUID(),
      child: randomUUID(),
      grandparent: randomUUID(),
      diana: randomUUID(),
    },
    assets: { joint: randomUUID(), own: randomUUID(), proposed: randomUUID() },
  };
  const { caseId, otherCaseId, alice, bruno, diana, people, assets } = family;
  await withClient(adminTarget(database), async (client) => {
    const run = (text: string, values: unknown[]) => client.query(text, values);
    await run(`INSERT INTO cases.case_file (id) VALUES ($1), ($2)`, [caseId, otherCaseId]);
    await run(
      `INSERT INTO cases.member (account_id, case_id) VALUES ($1, $4), ($2, $4), ($3, $5)`,
      [alice, bruno, diana, caseId, otherCaseId],
    );
    await run(
      `INSERT INTO cases.person (id, case_id, keeper_account_id, account_id, display_name, case_member)
       VALUES ($1, $6, $8, $8, 'Alice', true), ($2, $6, $9, $9, 'Bruno', true),
              ($3, $6, $8, NULL, 'Child', true), ($4, $6, $9, NULL, 'Grandparent', false),
              ($5, $7, $10, $10, 'Diana', true)`,
      [
        people.alice,
        people.bruno,
        people.child,
        people.grandparent,
        people.diana,
        caseId,
        otherCaseId,
        alice,
        bruno,
        diana,
      ],
    );
    for (const person of Object.values(people)) {
      await run(`INSERT INTO cases.person_profile (person_id, facts) VALUES ($1, '{}')`, [person]);
    }
    await run(
      `INSERT INTO cases.person_finances (person_id, incomes) VALUES ($1, '[]'), ($2, '[]')`,
      [people.alice, people.bruno],
    );
    await run(
      `INSERT INTO cases.dependence (case_id, person_id, depends_on_id) VALUES ($1, $2, $3)`,
      [caseId, people.child, people.alice],
    );
    await run(
      `INSERT INTO cases.relationship (case_id, kind, from_person_id, to_person_id)
       VALUES ($1, 'parent', $2, $4), ($1, 'parent', $3, $4), ($1, 'parent', $5, $3)`,
      [caseId, people.alice, people.bruno, people.child, people.grandparent],
    );
    await run(
      `INSERT INTO cases.share (case_id, person_id, grantee_account_id, scope)
       VALUES ($1, $2, $3, 'profile')`,
      [caseId, people.child, bruno],
    );
    for (const id of Object.values(assets)) {
      await run(
        `INSERT INTO cases.asset (id, case_id, kind, value_amount, value_currency, valued_at)
         VALUES ($1, $2, 'real_estate', 500000, 'BRL', '2026-01-01')`,
        [id, caseId],
      );
    }
    await run(
      `INSERT INTO cases.asset_owner (case_id, asset_id, person_id, share, confirmed)
       VALUES ($1, $2, $5, 0.5, true), ($1, $2, $6, 0.5, true), ($1, $3, $5, 1, true),
              ($1, $4, $5, 0.6, true), ($1, $4, $6, 0.4, false)`,
      [caseId, assets.joint, assets.own, assets.proposed, people.alice, people.bruno],
    );
  });
  return family;
}

let family: Family;
beforeAll(async () => {
  database = await freshDatabase();
  await migrate(migratorTarget(database), await realMigrations(), await containerPolicy());
  family = await seedFamily();
});
afterAll(async () => {
  await dropDatabase(database);
});

interface AsOptions {
  /** Commits instead of rolling back, for checks that need the admin's view afterwards. */
  readonly commit?: boolean;
}

/** Runs `work` as the role, in a transaction acting for `account`. */
async function as<T>(
  role: 'app_api' | 'app_jobs',
  account: string | undefined,
  work: (client: pg.Client) => Promise<T>,
  { commit = false }: AsOptions = {},
): Promise<T> {
  return withClient(roleTarget(database, role), async (client) => {
    await client.query('BEGIN');
    try {
      if (account !== undefined) await actFor(client, account);
      const result = await work(client);
      if (commit) await client.query('COMMIT');
      return result;
    } finally {
      if (!commit) await client.query('ROLLBACK');
    }
  });
}

const actFor = (client: pg.Client, account: string) =>
  client.query(`SELECT pg_catalog.set_config('app.account_id', $1, true)`, [account]);

const ids = async (client: pg.Client, sql: string, values: unknown[] = []) =>
  (await client.query<{ id: string }>(sql, values)).rows.map((row) => row.id).sort();

const sorted = (...values: string[]) => [...values].sort();

/** What the identity sees of every table, as IDs. */
async function visible(client: pg.Client) {
  return {
    cases: await ids(client, 'SELECT id FROM cases.case_file'),
    members: await ids(client, 'SELECT account_id AS id FROM cases.member'),
    people: await ids(client, 'SELECT id FROM cases.person'),
    profiles: await ids(client, 'SELECT person_id AS id FROM cases.person_profile'),
    finances: await ids(client, 'SELECT person_id AS id FROM cases.person_finances'),
    dependence: await ids(client, 'SELECT person_id AS id FROM cases.dependence'),
    relationships: (await client.query('SELECT 1 FROM cases.relationship')).rowCount,
    shares: await ids(client, 'SELECT person_id AS id FROM cases.share'),
    assets: await ids(client, 'SELECT id FROM cases.asset'),
    owners: await ids(
      client,
      `SELECT asset_id || ':' || person_id || ':' || confirmed AS id FROM cases.asset_owner`,
    ),
  };
}

const ownerRow = (asset: string, person: string, confirmed: boolean) =>
  `${asset}:${person}:${String(confirmed)}`;

/** Whether a statement is refused, rather than filtered to no rows. */
async function refused(client: pg.Client, sql: string, values: unknown[] = []) {
  await client.query('SAVEPOINT attempt');
  try {
    await client.query(sql, values);
    return 'allowed';
  } catch (error) {
    return (error as { code?: string }).code ?? 'error';
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT attempt');
  }
}

const insufficientPrivilege = '42501';
const foreignKeyViolation = '23503';
const checkViolation = '23514';

async function countAsAdmin(sql: string, values: unknown[] = []) {
  return withClient(adminTarget(database), async (client) => {
    const result = await client.query<{ n: number }>(`SELECT count(*)::int AS n ${sql}`, values);
    return result.rows[0]?.n ?? -1;
  });
}

/** Resolves once the backend waits on a lock, so a race test runs the interleaving it means to. */
async function waitForLock(pid: number | undefined) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const waiting = await countAsAdmin(
      "FROM pg_catalog.pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'",
      [pid],
    );
    if (waiting === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The second transaction never waited on a lock');
}

describe('the case schema access matrix (spec 0007, R1)', () => {
  it('forces row-level security on every case table', async () => {
    const shape = await withClient(adminTarget(database), async (client) => {
      const result = await client.query<{ name: string; forced: boolean }>(
        `SELECT c.relname AS name, c.relrowsecurity AND c.relforcerowsecurity AS forced
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'cases' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') ORDER BY 1`,
      );
      return result.rows;
    });
    expect(shape).toEqual(tables.map((name) => ({ name, forced: true })));
  });

  it('gives app_api reads, the keeper writes and no write that crosses keepers', async () => {
    const granted = await withClient(adminTarget(database), async (client) => {
      const result = await client.query<{ table: string; privilege: string; columns: string[] }>(
        `SELECT c.relname AS table, p.privilege,
                ARRAY(SELECT a.attname::text FROM pg_catalog.pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                         AND pg_catalog.has_column_privilege('app_api', c.oid, a.attnum, p.privilege)
                       ORDER BY a.attnum) AS columns
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) AS p(privilege)
          WHERE n.nspname = 'cases' AND c.relkind = 'r' ORDER BY 1, 2`,
      );
      return Object.fromEntries(
        result.rows
          .filter((row) => row.columns.length > 0)
          .map((row) => [`${row.table} ${row.privilege}`, row.columns]),
      );
    });
    expect(granted).toEqual({
      'asset UPDATE': [
        'kind',
        'value_amount',
        'value_currency',
        'valued_at',
        'liquid',
        'sold',
        'updated_at',
      ],
      'asset_owner UPDATE': ['confirmed'],
      'dependence INSERT': ['case_id', 'person_id', 'depends_on_id'],
      'person INSERT': ['id', 'case_id', 'keeper_account_id', 'display_name', 'case_member'],
      'person UPDATE': ['display_name', 'case_member'],
      'person_finances INSERT': ['person_id', 'incomes', 'assets_recorded_in_full'],
      'person_finances UPDATE': ['incomes', 'assets_recorded_in_full', 'updated_at'],
      'person_profile INSERT': ['person_id', 'facts', 'dependence_answered'],
      'person_profile UPDATE': ['facts', 'dependence_answered', 'updated_at'],
      'relationship INSERT': ['id', 'case_id', 'kind', 'from_person_id', 'to_person_id', 'details'],
      'relationship UPDATE': ['details'],
      'share INSERT': ['case_id', 'person_id', 'grantee_account_id', 'scope'],
    });
  });

  it('lets app_jobs read and delete only members and people, and the other roles nothing', async () => {
    const access = await withClient(adminTarget(database), async (client) => {
      const result = await client.query<{ role: string; table: string; privilege: string }>(
        `SELECT r.role, c.relname AS table, p.privilege
           FROM pg_catalog.unnest($1::text[]) AS r(role)
          CROSS JOIN pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
                             ('REFERENCES'), ('TRIGGER')) AS p(privilege)
          WHERE n.nspname = 'cases' AND c.relkind = 'r'
            AND (pg_catalog.has_table_privilege(r.role, c.oid, p.privilege)
              OR CASE WHEN p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                      THEN pg_catalog.has_any_column_privilege(r.role, c.oid, p.privilege)
                      ELSE false END)
          ORDER BY 1, 2, 3`,
        [[...runtimeRoles.filter((role) => role !== 'app_api'), ...retiredRoles, ...definerRoles]],
      );
      return result.rows.map(({ role, table, privilege }) => `${role} ${table} ${privilege}`);
    });
    expect(access).toEqual([
      'app_jobs member DELETE',
      'app_jobs member SELECT',
      'app_jobs person DELETE',
      'app_jobs person SELECT',
      'cases_definer asset DELETE',
      'cases_definer asset INSERT',
      'cases_definer asset SELECT',
      'cases_definer asset_owner INSERT',
      'cases_definer asset_owner SELECT',
      'cases_definer asset_owner UPDATE',
      'cases_definer case_file DELETE',
      'cases_definer case_file INSERT',
      'cases_definer case_file SELECT',
      'cases_definer member INSERT',
      'cases_definer member SELECT',
      'cases_definer person INSERT',
      'cases_definer person SELECT',
      'cases_definer person UPDATE',
      'cases_definer share DELETE',
      'cases_definer share SELECT',
    ]);
  });

  it('runs the definer functions as cases_definer, callable by app_api only where it needs them', async () => {
    const functions = await withClient(adminTarget(database), async (client) => {
      const result = await client.query<{
        name: string;
        owner: string;
        definer: boolean;
        config: string[];
        callers: string[];
      }>(
        `SELECT p.proname AS name, pg_catalog.pg_get_userbyid(p.proowner) AS owner,
                p.prosecdef AS definer, p.proconfig AS config,
                ARRAY(SELECT r.rolname::text FROM pg_catalog.pg_roles r
                       WHERE r.rolname = ANY ($1::text[])
                         AND pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')
                       ORDER BY 1) AS callers
           FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'cases' ORDER BY 1`,
        [[...runtimeRoles, ...retiredRoles]],
      );
      return result.rows;
    });
    const definer = {
      owner: 'cases_definer',
      definer: true,
      config: ['search_path=pg_catalog, pg_temp'],
    };
    expect(functions).toEqual([
      { name: 'add_asset', ...definer, callers: ['app_api'] },
      { name: 'create_case', ...definer, callers: ['app_api'] },
      { name: 'drop_empty_case', ...definer, callers: [] },
      { name: 'drop_unowned_asset', ...definer, callers: [] },
      { name: 'hand_over', ...definer, callers: ['app_api'] },
      { name: 'is_member', ...definer, callers: ['app_api'] },
      { name: 'join_case', ...definer, callers: ['app_api'] },
      { name: 'set_owner', ...definer, callers: ['app_api'] },
    ]);
  });

  it('shows nothing without an identity', async () => {
    for (const role of ['app_api', 'app_jobs'] as const) {
      await as(role, undefined, async (client) => {
        if (role === 'app_jobs') {
          expect(await ids(client, 'SELECT account_id AS id FROM cases.member')).toEqual([]);
          expect(await ids(client, 'SELECT id FROM cases.person')).toEqual([]);
          return;
        }
        expect(await visible(client)).toEqual({
          cases: [],
          members: [],
          people: [],
          profiles: [],
          finances: [],
          dependence: [],
          relationships: 0,
          shares: [],
          assets: [],
          owners: [],
        });
      });
    }
  });

  it('shows a member the case, its people and relationships, and only the facts kept or shared', async () => {
    const { caseId, alice, bruno, people, assets } = family;
    expect(await as('app_api', alice, visible)).toEqual({
      cases: [caseId],
      members: sorted(alice, bruno),
      people: sorted(people.alice, people.bruno, people.child, people.grandparent),
      profiles: sorted(people.alice, people.child),
      finances: [people.alice],
      dependence: [people.child],
      relationships: 3,
      shares: [people.child],
      assets: sorted(assets.joint, assets.own, assets.proposed),
      // Bruno's share of the joint asset, and his pending row, stay Bruno's.
      owners: sorted(
        ownerRow(assets.joint, people.alice, true),
        ownerRow(assets.own, people.alice, true),
        ownerRow(assets.proposed, people.alice, true),
      ),
    });
    expect(await as('app_api', bruno, visible)).toEqual({
      cases: [caseId],
      members: sorted(alice, bruno),
      people: sorted(people.alice, people.bruno, people.child, people.grandparent),
      // The child's profile, and with it the child's dependence, is shared with Bruno.
      profiles: sorted(people.bruno, people.child, people.grandparent),
      finances: [people.bruno],
      dependence: [people.child],
      relationships: 3,
      shares: [people.child],
      // The proposed asset shows to Bruno's keeper through the pending row, to confirm or decline.
      assets: sorted(assets.joint, assets.proposed),
      owners: sorted(
        ownerRow(assets.joint, people.bruno, true),
        ownerRow(assets.proposed, people.bruno, false),
      ),
    });
  });

  it('shows a member of another case nothing of this one', async () => {
    const { otherCaseId, diana, people } = family;
    expect(await as('app_api', diana, visible)).toEqual({
      cases: [otherCaseId],
      members: [diana],
      people: [people.diana],
      profiles: [people.diana],
      finances: [],
      dependence: [],
      relationships: 0,
      shares: [],
      assets: [],
      owners: [],
    });
  });

  it('shows a finances share the shared person’s owner rows and their assets, never a co-owner’s', async () => {
    const { caseId, alice, bruno, people, assets } = family;
    await as('app_api', alice, async (client) => {
      await client.query(
        `INSERT INTO cases.share (case_id, person_id, grantee_account_id, scope)
         VALUES ($1, $2, $3, 'finances')`,
        [caseId, people.alice, bruno],
      );
      await actFor(client, bruno);
      const seen = await visible(client);
      expect(seen.finances).toEqual(sorted(people.alice, people.bruno));
      expect(seen.assets).toEqual(sorted(assets.joint, assets.own, assets.proposed));
      expect(seen.owners).toContain(ownerRow(assets.own, people.alice, true));
      // Revoking hides them again at once.
      await actFor(client, alice);
      await client.query(
        `DELETE FROM cases.share WHERE person_id = $1 AND grantee_account_id = $2 AND scope = 'finances'`,
        [people.alice, bruno],
      );
      await actFor(client, bruno);
      const after = await visible(client);
      expect(after.finances).toEqual([people.bruno]);
      expect(after.assets).toEqual(sorted(assets.joint, assets.proposed));
    });
  });

  it('hides a shared profile at once when the share is revoked', async () => {
    const { alice, bruno, people } = family;
    await as('app_api', alice, async (client) => {
      await client.query(
        `DELETE FROM cases.share WHERE person_id = $1 AND grantee_account_id = $2`,
        [people.child, bruno],
      );
      await actFor(client, bruno);
      const seen = await visible(client);
      expect(seen.profiles).toEqual(sorted(people.bruno, people.grandparent));
      expect(seen.dependence).toEqual([]);
      expect(seen.shares).toEqual([]);
    });
  });

  it('lets only the keeper write a person and the person’s facts', async () => {
    const { caseId, otherCaseId, alice, bruno, people } = family;
    await as('app_api', bruno, async (client) => {
      const changed = async (sql: string, values: unknown[]) =>
        (await client.query(sql, values)).rowCount;
      expect(
        await changed(`UPDATE cases.person SET display_name = 'X' WHERE id = $1`, [people.child]),
      ).toBe(0);
      expect(await changed(`DELETE FROM cases.person WHERE id = $1`, [people.alice])).toBe(0);
      expect(
        await changed(
          `UPDATE cases.person_profile SET facts = '{"studying":true}' WHERE person_id = $1`,
          [people.child],
        ),
      ).toBe(0);
      expect(
        await changed(`DELETE FROM cases.person_finances WHERE person_id = $1`, [people.alice]),
      ).toBe(0);
      expect(
        await changed(`DELETE FROM cases.dependence WHERE person_id = $1`, [people.child]),
      ).toBe(0);
      expect(await changed(`DELETE FROM cases.share WHERE person_id = $1`, [people.child])).toBe(0);
      expect(
        await refused(
          client,
          `INSERT INTO cases.person_finances (person_id, incomes) VALUES ($1, '[]')`,
          [people.child],
        ),
      ).toBe(insufficientPrivilege);
      expect(
        await refused(
          client,
          `INSERT INTO cases.dependence (case_id, person_id, depends_on_id) VALUES ($1, $2, $3)`,
          [caseId, people.child, people.bruno],
        ),
      ).toBe(insufficientPrivilege);
      expect(
        await refused(
          client,
          `INSERT INTO cases.share (case_id, person_id, grantee_account_id, scope) VALUES ($1, $2, $3, 'finances')`,
          [caseId, people.alice, bruno],
        ),
      ).toBe(insufficientPrivilege);
      // A person is added kept by the identity, without an account, in the identity's own case.
      expect(
        await refused(
          client,
          `INSERT INTO cases.person (case_id, keeper_account_id, account_id, display_name, case_member)
           VALUES ($1, $2, $2, 'Someone', true)`,
          [caseId, bruno],
        ),
      ).toBe(insufficientPrivilege);
      expect(
        await refused(
          client,
          `INSERT INTO cases.person (case_id, keeper_account_id, display_name, case_member)
           VALUES ($1, $2, 'Someone', true)`,
          [caseId, alice],
        ),
      ).toBe(insufficientPrivilege);
      expect(
        await refused(
          client,
          `INSERT INTO cases.person (case_id, keeper_account_id, display_name, case_member)
           VALUES ($1, $2, 'Someone', true)`,
          [otherCaseId, bruno],
        ),
      ).toBe(foreignKeyViolation);
      expect(
        await refused(
          client,
          `INSERT INTO cases.person (case_id, keeper_account_id, display_name, case_member)
           VALUES ($1, $2, 'Someone', false)`,
          [caseId, bruno],
        ),
      ).toBe('allowed');
      expect(
        await refused(client, `UPDATE cases.person SET keeper_account_id = $1 WHERE id = $2`, [
          bruno,
          people.child,
        ]),
      ).toBe(insufficientPrivilege);
    });
    await as('app_api', alice, async (client) => {
      expect(
        (
          await client.query(
            `UPDATE cases.person_profile SET facts = '{"studying":true}', dependence_answered = true WHERE person_id = $1`,
            [people.child],
          )
        ).rowCount,
      ).toBe(1);
      expect(
        (await client.query(`DELETE FROM cases.person WHERE id = $1`, [people.child])).rowCount,
      ).toBe(1);
      // Her own person goes only when she leaves the case.
      expect(
        (await client.query(`DELETE FROM cases.person WHERE id = $1`, [people.alice])).rowCount,
      ).toBe(0);
    });
  });

  it('lets the keeper of either person write a relationship, only within the case', async () => {
    const { caseId, otherCaseId, alice, diana, people } = family;
    const edge = (client: pg.Client, inCase: string, from: string, to: string) =>
      refused(
        client,
        `INSERT INTO cases.relationship (case_id, kind, from_person_id, to_person_id)
         VALUES ($1, 'spouse', $2, $3)`,
        [inCase, from, to],
      );
    await as('app_api', alice, async (client) => {
      expect(await edge(client, caseId, people.alice, people.bruno)).toBe('allowed');
      expect(await edge(client, caseId, people.bruno, people.grandparent)).toBe(
        insufficientPrivilege,
      );
      expect(await edge(client, caseId, people.alice, people.diana)).toBe(foreignKeyViolation);
      // Bruno's edge to his parent is only Bruno's to change.
      const changed = await client.query(
        `UPDATE cases.relationship SET details = '{"custody":"none"}' WHERE from_person_id = $1`,
        [people.grandparent],
      );
      expect(changed.rowCount).toBe(0);
    });
    await as('app_api', diana, async (client) => {
      expect(await edge(client, otherCaseId, people.diana, people.alice)).toBe(foreignKeyViolation);
    });
  });

  it('lets a confirmed owner’s keeper change an asset, and a co-owner’s keeper confirm a pending row', async () => {
    const { bruno, alice, people, assets } = family;
    await as('app_api', bruno, async (client) => {
      const value = (asset: string) =>
        client.query(`UPDATE cases.asset SET value_amount = 1 WHERE id = $1`, [asset]);
      expect((await value(assets.own)).rowCount).toBe(0);
      expect((await value(assets.proposed)).rowCount).toBe(0);
      expect((await value(assets.joint)).rowCount).toBe(1);
      expect(
        (
          await client.query(
            `UPDATE cases.asset_owner SET confirmed = true WHERE asset_id = $1 AND person_id = $2`,
            [assets.proposed, people.bruno],
          )
        ).rowCount,
      ).toBe(1);
      expect((await value(assets.proposed)).rowCount).toBe(1);
    });
    await as('app_api', alice, async (client) => {
      expect(
        await refused(
          client,
          `UPDATE cases.asset_owner SET confirmed = false WHERE asset_id = $1 AND person_id = $2`,
          [assets.own, people.alice],
        ),
      ).toBe(insufficientPrivilege);
      expect(
        (
          await client.query(`UPDATE cases.asset_owner SET confirmed = true WHERE person_id = $1`, [
            people.bruno,
          ])
        ).rowCount,
      ).toBe(0);
    });
  });

  it('refuses app_api the rows whose writes cross keepers, which go through cases_definer', async () => {
    const { caseId, alice, people, assets } = family;
    await as('app_api', alice, async (client) => {
      for (const [sql, values] of [
        [`INSERT INTO cases.case_file DEFAULT VALUES`, []],
        [`INSERT INTO cases.member (account_id, case_id) VALUES ($1, $2)`, [randomUUID(), caseId]],
        [
          `INSERT INTO cases.asset (case_id, kind, value_amount, value_currency, valued_at)
           VALUES ($1, 'cash', 1, 'BRL', '2026-01-01')`,
          [caseId],
        ],
        [
          `INSERT INTO cases.asset_owner (case_id, asset_id, person_id, share, confirmed)
           VALUES ($1, $2, $3, 0.1, true)`,
          [caseId, assets.joint, people.child],
        ],
        [`UPDATE cases.asset_owner SET share = 1 WHERE person_id = $1`, [people.alice]],
        [`UPDATE cases.person SET keeper_account_id = $1 WHERE id = $2`, [alice, people.child]],
        [`SELECT cases.drop_empty_case()`, []],
      ] as const) {
        expect(await refused(client, sql, [...values]), sql).toBe(insufficientPrivilege);
      }
    });
  });

  it('keeps names, shares and amounts within their bounds', async () => {
    const { caseId, alice, people } = family;
    await as('app_api', alice, async (client) => {
      const name = (displayName: string) =>
        refused(
          client,
          `INSERT INTO cases.person (case_id, keeper_account_id, display_name, case_member)
           VALUES ($1, $2, $3, true)`,
          [caseId, alice, displayName],
        );
      expect(await name('')).toBe(checkViolation);
      expect(await name(' Padded')).toBe(checkViolation);
      expect(await name('x'.repeat(81))).toBe(checkViolation);
      expect(await name('x'.repeat(80))).toBe('allowed');
      expect(
        await refused(client, `UPDATE cases.person_profile SET facts = '[]' WHERE person_id = $1`, [
          people.alice,
        ]),
      ).toBe(checkViolation);
      expect(
        await refused(
          client,
          `UPDATE cases.person_finances SET incomes = '{}' WHERE person_id = $1`,
          [people.alice],
        ),
      ).toBe(checkViolation);
      expect(
        await refused(
          client,
          `INSERT INTO cases.dependence (case_id, person_id, depends_on_id) VALUES ($1, $2, $2)`,
          [caseId, people.alice],
        ),
      ).toBe(checkViolation);
    });
  });
});

describe('cascades and erasure in the case schema (spec 0007, R1 and R9)', () => {
  it('deletes an asset with its last confirmed owner row, pending rows included, and not before', async () => {
    const own = await seedFamily();
    await as(
      'app_api',
      own.alice,
      async (client) => {
        await client.query(`DELETE FROM cases.asset_owner WHERE person_id = $1`, [
          own.people.alice,
        ]);
      },
      { commit: true },
    );
    const assets = await withClient(adminTarget(database), async (client) =>
      ids(client, 'SELECT id FROM cases.asset WHERE case_id = $1', [own.caseId]),
    );
    expect(assets).toEqual([own.assets.joint]);
    expect(
      await countAsAdmin('FROM cases.asset_owner WHERE asset_id = $1', [own.assets.proposed]),
    ).toBe(0);
  });

  it('lets a member leave, only themselves, taking their people, facts, shares and relationships', async () => {
    const leaving = await seedFamily();
    const { caseId, alice, bruno, people, assets } = leaving;
    const leave = 'DELETE FROM cases.member WHERE account_id = $1';
    await as('app_api', alice, async (client) => {
      expect((await client.query(leave, [bruno])).rowCount).toBe(0);
    });
    await as(
      'app_api',
      bruno,
      async (client) => {
        expect((await client.query(leave, [bruno])).rowCount).toBe(1);
      },
      { commit: true },
    );
    await as('app_api', alice, async (client) => {
      const seen = await visible(client);
      expect(seen.members).toEqual([alice]);
      expect(seen.people).toEqual(sorted(people.alice, people.child));
      expect(seen.relationships).toBe(1);
      expect(seen.shares).toEqual([]);
      expect(seen.assets).toEqual(sorted(assets.joint, assets.own, assets.proposed));
    });
    expect(await countAsAdmin('FROM cases.share WHERE case_id = $1', [caseId])).toBe(0);
    expect(
      await countAsAdmin('FROM cases.person_profile WHERE person_id = $1', [people.grandparent]),
    ).toBe(0);
    expect(await countAsAdmin('FROM cases.asset_owner WHERE person_id = $1', [people.bruno])).toBe(
      0,
    );
    expect(await countAsAdmin('FROM cases.case_file WHERE id = $1', [caseId])).toBe(1);
  });

  it('deletes the case with its last member', async () => {
    const ending = await seedFamily();
    for (const account of [ending.alice, ending.bruno]) {
      await as(
        'app_jobs',
        account,
        (client) => client.query('DELETE FROM cases.member WHERE account_id = $1', [account]),
        { commit: true },
      );
    }
    expect(await countAsAdmin('FROM cases.case_file WHERE id = $1', [ending.caseId])).toBe(0);
    for (const table of [
      'member',
      'person',
      'dependence',
      'asset',
      'asset_owner',
      'relationship',
      'share',
    ]) {
      expect(
        await countAsAdmin(`FROM cases.${table} WHERE case_id = $1`, [ending.caseId]),
        table,
      ).toBe(0);
    }
    expect(await countAsAdmin('FROM cases.case_file WHERE id = $1', [ending.otherCaseId])).toBe(1);
  });

  it('removes an asset, and a case, when its last two rows go in concurrent transactions', async () => {
    const racing = await seedFamily();
    const { assets, people, alice, bruno } = racing;
    /** Deletes in two open transactions, the second while the first has not committed. */
    async function race(
      role: 'app_api' | 'app_jobs',
      first: [string, string, unknown[]],
      second: [string, string, unknown[]],
    ) {
      await withClient(roleTarget(database, role), (one) =>
        withClient(roleTarget(database, role), async (two) => {
          for (const [client, [account, sql, values]] of [
            [one, first],
            [two, second],
          ] as const) {
            await client.query('BEGIN');
            await actFor(client, account);
            if (client === one) await client.query(sql, values);
          }
          const pid = (await two.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]
            ?.pid;
          const waiting = two.query(second[1], second[2]);
          await waitForLock(pid);
          await one.query('COMMIT');
          await waiting;
          await two.query('COMMIT');
        }),
      );
    }
    const removeOwnerRow = 'DELETE FROM cases.asset_owner WHERE asset_id = $1 AND person_id = $2';
    await race(
      'app_api',
      [alice, removeOwnerRow, [assets.joint, people.alice]],
      [bruno, removeOwnerRow, [assets.joint, people.bruno]],
    );
    expect(await countAsAdmin('FROM cases.asset WHERE id = $1', [assets.joint])).toBe(0);
    const leave = 'DELETE FROM cases.member WHERE account_id = $1';
    await race('app_jobs', [alice, leave, [alice]], [bruno, leave, [bruno]]);
    expect(await countAsAdmin('FROM cases.case_file WHERE id = $1', [racing.caseId])).toBe(0);
  });

  it('lets app_jobs under one identity erase nothing another account keeps', async () => {
    const { caseId, alice, people } = family;
    await as('app_jobs', alice, async (client) => {
      expect(await ids(client, 'SELECT id FROM cases.person WHERE case_id = $1', [caseId])).toEqual(
        sorted(people.alice, people.child),
      );
      expect((await client.query('DELETE FROM cases.person')).rowCount).toBe(2);
      expect((await client.query('DELETE FROM cases.member')).rowCount).toBe(1);
      for (const table of ['person_profile', 'asset', 'share']) {
        expect(await refused(client, `SELECT 1 FROM cases.${table}`), table).toBe(
          insufficientPrivilege,
        );
      }
    });
  });
});
