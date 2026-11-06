import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrap } from '../../src/db/bootstrap.ts';
import { runGuards } from '../../src/db/guards.ts';
import { appRoles, definerRoles, retiredRoles, type DatabasePolicy } from '../../src/db/policy.ts';
import { migrate } from '../../src/db/runner.ts';
import {
  adminTarget,
  bootstrapSql,
  containerPolicy,
  migratorTarget,
  realMigrations,
  withClient,
} from './support.ts';

// Neon's project owner is not a superuser: it holds CREATEROLE, CREATEDB, REPLICATION and BYPASSRLS
// and owns the database. Bootstrapping as such a role exercises the path every Neon build takes,
// including the ADMIN OPTION grants Postgres records for it, which a superuser never gets.
const owner = 'arca_test_owner';
const ownerPassword = randomBytes(24).toString('base64url');
const database = `arca_test_${randomBytes(6).toString('hex')}`;
const ownerTarget = { ...adminTarget(database), user: owner, password: ownerPassword };

async function dropAppRoles(): Promise<void> {
  await withClient(adminTarget('postgres'), async (client) => {
    const leftovers = await client.query<{ datname: string }>(
      `SELECT datname FROM pg_catalog.pg_database WHERE datname LIKE 'arca\\_test\\_%'`,
    );
    for (const { datname } of leftovers.rows) {
      await client.query(`DROP DATABASE ${client.escapeIdentifier(datname)} WITH (FORCE)`);
    }
    for (const role of [...appRoles, ...retiredRoles, ...definerRoles, owner]) {
      await client.query(`DROP ROLE IF EXISTS ${role}`);
    }
  });
}

let policy: DatabasePolicy;
beforeAll(async () => {
  await dropAppRoles();
  await withClient(adminTarget('postgres'), async (client) => {
    await client.query(
      `CREATE ROLE ${owner} LOGIN CREATEROLE CREATEDB REPLICATION BYPASSRLS PASSWORD '${ownerPassword}'`,
    );
    await client.query(`CREATE DATABASE ${database} OWNER ${owner}`);
  });
  const base = await containerPolicy();
  policy = {
    ...base,
    roles: { ...base.roles, exemptRoles: ['postgres', owner], ownerAdminRole: owner },
  };
});
afterAll(async () => {
  await dropAppRoles();
});

describe('bootstrap as a non-superuser owner', () => {
  it('creates the roles, reruns cleanly, and the guards pass with only the owner grants', async () => {
    await bootstrap(ownerTarget, await bootstrapSql());
    await bootstrap(ownerTarget, await bootstrapSql());
    await migrate(migratorTarget(database), await realMigrations(), policy);
    await withClient(adminTarget(database), async (client) => {
      expect(await runGuards(client, policy)).toEqual([]);
      const grants = await client.query(
        `SELECT pg_catalog.pg_get_userbyid(roleid) AS granted, admin_option, inherit_option, set_option
           FROM pg_catalog.pg_auth_members
          WHERE pg_catalog.pg_get_userbyid(member) = $1 ORDER BY 1`,
        [owner],
      );
      expect(grants.rows).toEqual(
        [...appRoles, ...retiredRoles, ...definerRoles].sort().map((granted) => ({
          granted,
          admin_option: true,
          inherit_option: false,
          set_option: false,
        })),
      );
    });
  });

  it('fails guard 5 when the owner also inherits an app role', async () => {
    await withClient(adminTarget(database), async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(`GRANT app_api TO ${owner} WITH INHERIT TRUE, SET TRUE`);
        expect(await runGuards(client, policy)).toContainEqual({
          guard: 5,
          problem: expect.stringContaining(`${owner} is a member of app_api`) as string,
        });
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });
});
