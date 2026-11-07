import { randomBytes, randomUUID } from 'node:crypto';
import { parseCalendarDate, type VersionIdentity } from '@arca/domain';
import { withIdentity } from '@arca/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog } from '../../src/audit/log.js';
import { credentialStore } from '../../src/auth/auth.js';
import { createStepUp } from '../../src/auth/step-up.js';
import { createAdminGrants, type AdminGrants } from '../../src/knowledge/admin-grants.js';
import { adminRole } from '../../src/knowledge/admins.js';
import { createKnowledgeDecisions } from '../../src/knowledge/decisions.js';
import { authTestDatabase, silentLogger, type AuthTestDatabase } from './auth-database.js';
import { ceremony, origin, person, toRequest, type Person } from './step-up-people.js';

// The admin role on the real migrations (ADR-0027). Synthetic data only.
let testDatabase: AuthTestDatabase;
let stepUp: ReturnType<typeof createStepUp>;
let owner: Person;
let ana: Person;
let bruno: Person;
let notices: string[];

/** Drizzle wraps the database's error; its cause carries the reason. */
const refusedBy = (reason: RegExp) => ({
  cause: { message: expect.stringMatching(reason) as unknown },
});

const version: VersionIdentity = {
  routeId: 'qm-sample',
  number: 1,
  effectiveFrom: parseCalendarDate('2026-01-01'),
  status: 'open',
  hash: 'a'.repeat(64),
};
const identityKey = `qm-sample/1/${'a'.repeat(64)}`;

const role = () => adminRole(() => testDatabase.apiDb, [owner.signedIn.accountId]);

function grants(): AdminGrants {
  return createAdminGrants({
    db: () => testDatabase.apiDb,
    authDb: () => testDatabase.authDb,
    role: role(),
    stepUp,
    audit: auditLog(testDatabase.auditDb),
    notify: (accountId, kind) => {
      notices.push(`${accountId}:${kind}`);
      return Promise.resolve();
    },
  });
}

const decisions = () =>
  createKnowledgeDecisions({
    db: testDatabase.apiDb,
    authDb: () => testDatabase.authDb,
    audit: auditLog(testDatabase.auditDb),
    catalog: { identities: (routeId) => (routeId === version.routeId ? [version] : []) },
    comparisons: { identities: () => [] },
    role: role(),
    origin,
    logger: silentLogger,
  });

/** A confirmed account with a passkey and a session. */
async function confirmed(): Promise<Person> {
  const someone = await person(testDatabase);
  await testDatabase.asAdmin((client) =>
    client.query('UPDATE auth.user SET confirmed_at = now() WHERE id = $1', [
      someone.signedIn.accountId,
    ]),
  );
  return someone;
}

async function inOneCase(...people: readonly Person[]) {
  const caseId = randomUUID();
  await testDatabase.asAdmin(async (client) => {
    await client.query('INSERT INTO cases.case_file (id) VALUES ($1)', [caseId]);
    for (const { signedIn } of people) {
      await client.query('INSERT INTO cases.member (account_id, case_id) VALUES ($1, $2)', [
        signedIn.accountId,
        caseId,
      ]);
    }
  });
}

/** Verifies an `admin_grant` step-up of `actor` bound to `granteeId`; answers its nonce. */
async function approveGrant(actor: Person, granteeId: string) {
  const nonce = new Uint8Array(randomBytes(16));
  const { verified } = await ceremony(
    stepUp,
    actor,
    toRequest('admin_grant', { action: 'grantAdmin', targets: [granteeId], nonce }),
  );
  expect(verified).toBe(true);
  return nonce;
}

async function grantWithStepUp(actor: Person, grantee: Person) {
  const nonce = await approveGrant(actor, grantee.signedIn.accountId);
  return grants().grant(actor.signedIn, grantee.signedIn.accountId, nonce);
}

const history = () =>
  testDatabase.asAdmin(
    async (client) =>
      (
        await client.query<Record<string, unknown>>(
          `SELECT kind, grantee_account_id, actor_account_id, actor_basis, actor_grant_id,
                  removes_grant_id, step_up_id IS NOT NULL AS spent, id
             FROM knowledge.admin_grant ORDER BY at, id`,
        )
      ).rows,
  );

const adminEvents = (accountId: string) =>
  testDatabase.asAdmin(
    async (client) =>
      (
        await client.query<{ code: string; actor: string; details: Record<string, unknown> }>(
          `SELECT code, actor_account_id AS actor, details FROM audit.event
            WHERE subject_account_id = $1 AND code LIKE 'admin_%' ORDER BY time, id`,
          [accountId],
        )
      ).rows,
  );

beforeAll(async () => {
  testDatabase = await authTestDatabase();
  const { authDb, auditDb } = testDatabase;
  stepUp = createStepUp({
    db: authDb,
    credentials: credentialStore(authDb),
    audit: auditLog(auditDb),
    origin,
    logger: silentLogger,
  });
});

afterAll(async () => {
  await testDatabase.drop();
});

beforeEach(async () => {
  notices = [];
  await testDatabase.asAdmin((client) =>
    client.query('TRUNCATE knowledge.decision, knowledge.admin_grant'),
  );
  [owner, ana, bruno] = [await confirmed(), await confirmed(), await confirmed()];
});

describe('giving the admin role (ADR-0027)', () => {
  it('stores a grant by an owner-list admin after a step-up bound to the grantee, and tells the owners', async () => {
    await inOneCase(owner, ana);
    expect(await role().isAdmin(ana.signedIn.accountId)).toBe(false);

    expect(await grantWithStepUp(owner, ana)).toBe('changed');

    expect(await role().isAdmin(ana.signedIn.accountId)).toBe(true);
    const [row] = await history();
    expect(row).toMatchObject({
      kind: 'grant',
      grantee_account_id: ana.signedIn.accountId,
      actor_account_id: owner.signedIn.accountId,
      actor_basis: 'owner_list',
      actor_grant_id: null,
      spent: true,
    });
    const event = {
      code: 'admin_granted',
      actor: owner.signedIn.accountId,
      details: { grantId: row?.['id'], accountId: ana.signedIn.accountId },
    };
    expect(await adminEvents(owner.signedIn.accountId)).toEqual([event]);
    expect(await adminEvents(ana.signedIn.accountId)).toEqual([event]);
    expect(notices).toEqual([`${owner.signedIn.accountId}:admin_role_changed`]);
  });

  it('refuses without a step-up, or with one bound to another account, storing nothing', async () => {
    await inOneCase(owner, ana, bruno);
    const service = grants();
    const unapproved = new Uint8Array(randomBytes(16));
    expect(await service.grant(owner.signedIn, ana.signedIn.accountId, unapproved)).toBe(
      'step_up_required',
    );
    const forBruno = await approveGrant(owner, bruno.signedIn.accountId);
    expect(await service.grant(owner.signedIn, ana.signedIn.accountId, forBruno)).toBe(
      'step_up_required',
    );
    expect(await history()).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('answers not_found alike for an account outside the case, an unknown one and an unconfirmed member, leaving the step-up unspent', async () => {
    const unconfirmed = await person(testDatabase);
    await inOneCase(owner, unconfirmed);
    await inOneCase(bruno);
    const service = grants();
    for (const granteeId of [bruno.signedIn.accountId, randomUUID()]) {
      const nonce = await approveGrant(owner, granteeId);
      expect(await service.grant(owner.signedIn, granteeId, nonce)).toBe('not_found');
    }
    const nonce = await approveGrant(owner, unconfirmed.signedIn.accountId);
    expect(await service.grant(owner.signedIn, unconfirmed.signedIn.accountId, nonce)).toBe(
      'not_found',
    );
    const unspent = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query(
            `SELECT FROM auth.step_up
              WHERE account_id = $1 AND purpose = 'admin_grant' AND consumed_at IS NOT NULL`,
            [owner.signedIn.accountId],
          )
        ).rowCount,
    );
    expect(unspent).toBe(0);
    expect(await history()).toEqual([]);
  });

  it('refuses an account that is not an admin', async () => {
    await inOneCase(owner, ana, bruno);
    const nonce = await approveGrant(ana, bruno.signedIn.accountId);
    expect(await grants().grant(ana.signedIn, bruno.signedIn.accountId, nonce)).toBe('not_admin');
    expect(await history()).toEqual([]);
  });

  it('leaves an admin as they are, owner-list admins included', async () => {
    await inOneCase(owner, ana);
    expect(await grantWithStepUp(owner, ana)).toBe('changed');
    expect(await grantWithStepUp(owner, ana)).toBe('unchanged');
    expect(await grantWithStepUp(ana, owner)).toBe('unchanged');
    expect(await history()).toHaveLength(1);
  });

  it('lets a granted admin give the role, recording the grant that made them one', async () => {
    await inOneCase(owner, ana, bruno);
    await grantWithStepUp(owner, ana);
    expect(await grantWithStepUp(ana, bruno)).toBe('changed');
    const [anaGrant, brunoGrant] = await history();
    expect(brunoGrant).toMatchObject({
      actor_account_id: ana.signedIn.accountId,
      actor_basis: 'grant',
      actor_grant_id: anaGrant?.['id'],
    });
    expect(await grants().list(ana.signedIn.accountId)).toEqual(
      expect.arrayContaining([
        { accountId: owner.signedIn.accountId, onOwnerList: true },
        { accountId: ana.signedIn.accountId, onOwnerList: false },
        { accountId: bruno.signedIn.accountId, onOwnerList: false },
      ]),
    );
  });
});

describe('taking the admin role away (ADR-0027)', () => {
  it('ends the grant at once, with no step-up, audited for both and told to the owners', async () => {
    await inOneCase(owner, ana);
    await grantWithStepUp(owner, ana);
    notices = [];
    expect(await grants().remove(owner.signedIn, ana.signedIn.accountId)).toBe('changed');
    expect(await role().isAdmin(ana.signedIn.accountId)).toBe(false);
    const [given, removed] = await history();
    expect(removed).toMatchObject({
      kind: 'removal',
      grantee_account_id: ana.signedIn.accountId,
      removes_grant_id: given?.['id'],
      spent: false,
    });
    expect((await adminEvents(ana.signedIn.accountId)).map(({ code }) => code)).toEqual([
      'admin_granted',
      'admin_removed',
    ]);
    expect(notices).toEqual([`${owner.signedIn.accountId}:admin_role_changed`]);
    expect(await grants().list(ana.signedIn.accountId)).toBe('not_admin');
  });

  it('never takes the role from an owner-list admin, and leaves a member who is not one as they are', async () => {
    await inOneCase(owner, ana, bruno);
    await grantWithStepUp(owner, ana);
    expect(await grants().remove(ana.signedIn, owner.signedIn.accountId)).toBe('owner_list_admin');
    expect(await grants().remove(ana.signedIn, bruno.signedIn.accountId)).toBe('unchanged');
    expect(await grants().remove(bruno.signedIn, ana.signedIn.accountId)).toBe('not_admin');
    expect(await history()).toHaveLength(1);
  });

  it('answers not_found for an account outside the case', async () => {
    await inOneCase(owner);
    await inOneCase(ana);
    expect(await grants().remove(owner.signedIn, ana.signedIn.accountId)).toBe('not_found');
  });
});

describe("a granted admin's decisions (ADR-0027)", () => {
  it('stores a decision naming the grant, which keeps counting after the role is taken away', async () => {
    await inOneCase(owner, ana);
    await grantWithStepUp(owner, ana);
    const request = { subject: 'route', routeId: version.routeId, number: 1 } as const;
    expect(await decisions().decide(ana.signedIn, 'activate', request)).toHaveProperty('decided');
    const [anaGrant] = await history();
    const stored = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<Record<string, unknown>>(
            'SELECT admin_basis, admin_grant_id FROM knowledge.decision',
          )
        ).rows,
    );
    expect(stored).toEqual([{ admin_basis: 'grant', admin_grant_id: anaGrant?.['id'] }]);

    await grants().remove(owner.signedIn, ana.signedIn.accountId);
    expect(await decisions().states()).toEqual(new Map([[identityKey, 'active']]));
    expect(await decisions().decide(ana.signedIn, 'reject', request)).toEqual({
      refused: 'not_admin',
    });
  });

  it('counts nothing for a decision naming a grant that was not in force at its time', async () => {
    await inOneCase(owner, ana);
    await grantWithStepUp(owner, ana);
    await grants().remove(owner.signedIn, ana.signedIn.accountId);
    const [anaGrant] = await history();
    // Stored past the service, as only the server's admin could, after the grant ended.
    await testDatabase.asAdmin((client) =>
      client.query(
        `INSERT INTO knowledge.decision (kind, subject_kind, route_id, version_number, content_hash,
           approver_account_id, proof, admin_basis, admin_grant_id)
         VALUES ('activate', 'route', $1, 1, $2, $3, 'session', 'grant', $4)`,
        [version.routeId, version.hash, ana.signedIn.accountId, anaGrant?.['id']],
      ),
    );
    expect(await decisions().states()).toEqual(new Map());
  });
});

describe('the admin grant table under row-level security (ADR-0027)', () => {
  const insertGrant = (actor: string, grantee: string, changes = sql``) => sql`
    INSERT INTO knowledge.admin_grant (kind, grantee_account_id, actor_account_id, actor_basis,
      step_up_id)
    VALUES ('grant', ${grantee}, ${actor}, 'owner_list', ${randomUUID()})${changes}`;

  it('lets app_auth insert a grant only by its own identity with a spent admin_grant step-up', async () => {
    const [actor, grantee] = [owner.signedIn.accountId, ana.signedIn.accountId];
    await expect(
      withIdentity(testDatabase.authDb, { accountId: actor }, (tx) =>
        tx.execute(insertGrant(actor, grantee)),
      ),
    ).rejects.toMatchObject(refusedBy(/row-level security/));
    await expect(
      withIdentity(testDatabase.authDb, { accountId: grantee }, (tx) =>
        tx.execute(insertGrant(actor, grantee)),
      ),
    ).rejects.toMatchObject(refusedBy(/row-level security/));
  });

  it('refuses a removal naming no grant of its grantee, and a decision naming a grant of another account', async () => {
    await inOneCase(owner, ana, bruno);
    await grantWithStepUp(owner, ana);
    const [anaGrant] = await history();
    const actor = owner.signedIn.accountId;
    await expect(
      withIdentity(testDatabase.authDb, { accountId: actor }, (tx) =>
        tx.execute(sql`
          INSERT INTO knowledge.admin_grant (kind, grantee_account_id, actor_account_id,
            actor_basis, removes_grant_id)
          VALUES ('removal', ${bruno.signedIn.accountId}, ${actor}, 'owner_list',
            ${String(anaGrant?.['id'])})`),
      ),
    ).rejects.toMatchObject(refusedBy(/row-level security/));
    await expect(
      withIdentity(testDatabase.authDb, { accountId: bruno.signedIn.accountId }, (tx) =>
        tx.execute(sql`
          INSERT INTO knowledge.decision (id, kind, subject_kind, route_id, version_number,
            content_hash, approver_account_id, proof, admin_basis, admin_grant_id)
          VALUES (${randomUUID()}, 'activate', 'route', 'qm-sample', 1, ${version.hash},
            ${bruno.signedIn.accountId}, 'session', 'grant', ${String(anaGrant?.['id'])})`),
      ),
    ).rejects.toMatchObject(refusedBy(/row-level security/));
  });

  it('lets nobody change or delete a row, and app_api only read', async () => {
    await inOneCase(owner, ana);
    await grantWithStepUp(owner, ana);
    const denied = refusedBy(/^permission denied/);
    for (const db of [testDatabase.authDb, testDatabase.apiDb, testDatabase.jobsDb]) {
      await expect(
        db.execute(sql`UPDATE knowledge.admin_grant SET grantee_account_id = actor_account_id`),
      ).rejects.toMatchObject(denied);
      await expect(db.execute(sql`DELETE FROM knowledge.admin_grant`)).rejects.toMatchObject(
        denied,
      );
    }
    await expect(
      withIdentity(testDatabase.apiDb, { accountId: owner.signedIn.accountId }, (tx) =>
        tx.execute(insertGrant(owner.signedIn.accountId, bruno.signedIn.accountId)),
      ),
    ).rejects.toMatchObject(denied);
    expect(await history()).toHaveLength(1);
  });

  it('refuses a grant to oneself', async () => {
    await expect(
      testDatabase.asAdmin((client) =>
        client.query(
          `INSERT INTO knowledge.admin_grant (kind, grantee_account_id, actor_account_id, actor_basis, step_up_id)
           VALUES ('grant', $1, $1, 'owner_list', gen_random_uuid())`,
          [owner.signedIn.accountId],
        ),
      ),
    ).rejects.toThrow(/admin_grant_shape/);
  });
});
