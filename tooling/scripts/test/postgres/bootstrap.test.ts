import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrap } from '../../src/db/bootstrap.ts';
import {
  adminTarget,
  bootstrapSql,
  databaseComment,
  dropDatabase,
  freshDatabase,
  passwords,
  roleTarget,
  setComment,
  withClient,
} from './support.ts';

let database: string;
beforeAll(async () => {
  database = await freshDatabase();
});
afterAll(async () => {
  await dropDatabase(database);
});

async function roleSnapshot(): Promise<unknown> {
  return withClient(adminTarget(database), async (client) => {
    const roles = await client.query(
      `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin,
              rolreplication, rolbypassrls, rolconnlimit, rolvaliduntil
         FROM pg_catalog.pg_roles WHERE rolname LIKE 'app\\_%' ORDER BY rolname`,
    );
    const memberships = await client.query(
      `SELECT pg_catalog.pg_get_userbyid(roleid) AS granted, pg_catalog.pg_get_userbyid(member) AS member,
              admin_option, inherit_option, set_option
         FROM pg_catalog.pg_auth_members
        WHERE pg_catalog.pg_get_userbyid(roleid) LIKE 'app\\_%'
           OR pg_catalog.pg_get_userbyid(member) LIKE 'app\\_%'
        ORDER BY 1, 2`,
    );
    const databaseCreate = await client.query(
      `SELECT rolname FROM pg_catalog.pg_roles
        WHERE pg_catalog.has_database_privilege(oid, pg_catalog.current_database(), 'CREATE')
          AND rolname LIKE 'app\\_%' ORDER BY 1`,
    );
    return {
      roles: roles.rows,
      memberships: memberships.rows,
      databaseCreate: databaseCreate.rows,
    };
  });
}

describe('bootstrap', () => {
  it('creates the five app roles as plain login roles, and only app_migrator may create', async () => {
    const snapshot = (await roleSnapshot()) as {
      roles: { rolname: string }[];
      memberships: unknown[];
      databaseCreate: unknown[];
    };
    expect(snapshot.roles).toEqual(
      ['app_api', 'app_audit', 'app_auth', 'app_jobs', 'app_migrator'].map((rolname) => ({
        rolname,
        rolsuper: false,
        rolinherit: true,
        rolcreaterole: false,
        rolcreatedb: false,
        rolcanlogin: true,
        rolreplication: false,
        rolbypassrls: false,
        rolconnlimit: -1,
        rolvaliduntil: null,
      })),
    );
    expect(snapshot.memberships).toEqual([]);
    expect(snapshot.databaseCreate).toEqual([{ rolname: 'app_migrator' }]);
  });

  it('is idempotent and corrects drifted attributes', async () => {
    const before = await roleSnapshot();
    await bootstrap(adminTarget(database), await bootstrapSql());
    expect(await roleSnapshot()).toEqual(before);
    await withClient(adminTarget(database), (client) =>
      client.query('ALTER ROLE app_api CREATEDB BYPASSRLS NOLOGIN'),
    );
    await bootstrap(adminTarget(database), await bootstrapSql());
    expect(await roleSnapshot()).toEqual(before);
  });

  it('stores SCRAM verifiers that accept the passwords and nothing else', async () => {
    await withClient(adminTarget(database), async (client) => {
      const stored = await client.query<{ rolname: string; rolpassword: string | null }>(
        `SELECT rolname, rolpassword FROM pg_catalog.pg_authid
          WHERE rolname IN ('app_migrator', 'app_api', 'app_jobs', 'app_auth', 'app_audit') ORDER BY 1`,
      );
      for (const { rolpassword } of stored.rows) {
        expect(rolpassword).toMatch(/^SCRAM-SHA-256\$4096:/);
      }
      expect(stored.rows).toHaveLength(5);
    });
    for (const role of ['app_migrator', 'app_api', 'app_jobs', 'app_auth', 'app_audit'] as const) {
      const identity = await withClient(roleTarget(database, role), async (client) => {
        const result = await client.query<{ user: string }>('SELECT current_user AS user');
        return result.rows[0]?.user;
      });
      expect(identity).toBe(role);
    }
    await expect(
      withClient({ ...roleTarget(database, 'app_api'), password: passwords.app_jobs }, (client) =>
        client.query('SELECT 1'),
      ),
    ).rejects.toThrow('password authentication failed');
  });

  it('commits nothing when a statement fails', async () => {
    const before = await roleSnapshot();
    const sql = `${await bootstrapSql()}\nALTER ROLE app_api CREATEDB;\nSELECT 1/0;`;
    await expect(bootstrap(adminTarget(database), sql)).rejects.toThrow('division by zero');
    expect(await roleSnapshot()).toEqual(before);
  });

  it('marks the database on the first production build and refuses a preview there', async () => {
    const target = adminTarget(database);
    await expect(bootstrap(target, await bootstrapSql(), 'preview')).rejects.toThrow(
      'a preview build needs a branch of the marked production database',
    );
    await bootstrap(target, await bootstrapSql(), 'production');
    expect(await databaseComment(database)).toBe(
      `arca production endpoint: ${target.host.split('.')[0] ?? ''}`,
    );
    await bootstrap(target, await bootstrapSql(), 'production');

    const before = await roleSnapshot();
    await expect(bootstrap(target, await bootstrapSql(), 'preview')).rejects.toThrow(
      'a preview build reaches the production database',
    );
    expect(await roleSnapshot()).toEqual(before);
  });

  it('refuses production on a database marked for another endpoint', async () => {
    await setComment(database, 'arca production endpoint: ep-elsewhere');
    await expect(
      bootstrap(adminTarget(database), await bootstrapSql(), 'production'),
    ).rejects.toThrow('this production build reaches a database marked for another endpoint');
  });

  it('writes no mark when the bootstrap fails', async () => {
    await setComment(database, null);
    const sql = `${await bootstrapSql()}\nSELECT 1/0;`;
    await expect(bootstrap(adminTarget(database), sql, 'production')).rejects.toThrow(
      'division by zero',
    );
    expect(await databaseComment(database)).toBeNull();
  });
});
