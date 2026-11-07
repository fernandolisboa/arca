import { randomBytes, randomUUID } from 'node:crypto';
import {
  comparisonIdentityKey,
  comparisonSeriesId,
  parseCalendarDate,
  type VersionIdentity,
} from '@arca/domain';
import { withIdentity } from '@arca/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog } from '../../src/audit/log.js';
import { createStepUp } from '../../src/auth/step-up.js';
import { adminRole } from '../../src/knowledge/admins.js';
import {
  createKnowledgeDecisions,
  type KnowledgeDecisions,
} from '../../src/knowledge/decisions.js';
import { authTestDatabase, silentLogger, type AuthTestDatabase } from './auth-database.js';
import { comparisonTarget, legacyDecision, routeAction } from './knowledge-decision-legacy.js';
import { credentialStore } from '../../src/auth/auth.js';
import { origin, person, type Person } from './step-up-people.js';

// Knowledge decisions on the real migrations (spec 0007, R7; ADR-0027). Synthetic data only.
let testDatabase: AuthTestDatabase;
let stepUp: ReturnType<typeof createStepUp>;
let approver: Person;
let errors: string[];

const version: VersionIdentity = {
  routeId: 'qm-sample',
  number: 1,
  effectiveFrom: parseCalendarDate('2026-01-01'),
  status: 'open',
  hash: 'a'.repeat(64),
};
const identityKey = `qm-sample/1/${'a'.repeat(64)}`;
const catalog = {
  identities: (routeId: string) => (routeId === version.routeId ? [version] : []),
};
const comparisons = {
  identities: () => [{ comparisonId: comparisonSeriesId, number: 1, hash: 'c'.repeat(64) }],
};
const comparisonKey = comparisonIdentityKey({
  comparisonId: comparisonSeriesId,
  number: 1,
  hash: 'c'.repeat(64),
});
/** Drizzle wraps the database's error; its cause carries the reason. */
const denied = { cause: { message: expect.stringMatching(/^permission denied/) as unknown } };

function decisions(
  owners: readonly string[] = [approver.signedIn.accountId],
  identities: typeof catalog = catalog,
): KnowledgeDecisions {
  return createKnowledgeDecisions({
    db: testDatabase.apiDb,
    authDb: () => testDatabase.authDb,
    audit: auditLog(testDatabase.auditDb),
    catalog: identities,
    comparisons,
    role: adminRole(() => testDatabase.apiDb, owners),
    ownerList: owners,
    origin,
    logger: {
      info: () => undefined,
      error: ({ errorName }) => {
        errors.push(String(errorName));
      },
    },
  });
}

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
  errors = [];
  approver = await person(testDatabase);
  await testDatabase.asAdmin((client) => client.query('TRUNCATE knowledge.decision'));
});

const request = { subject: 'route', routeId: version.routeId, number: version.number } as const;

async function rows() {
  return testDatabase.asAdmin(
    async (client) =>
      (
        await client.query<Record<string, unknown>>(
          'SELECT * FROM knowledge.decision ORDER BY decided_at, id',
        )
      ).rows,
  );
}

async function decisionEvents(accountId: string) {
  return testDatabase.asAdmin(
    async (client) =>
      (
        await client.query<{ code: string; details: Record<string, unknown> }>(
          `SELECT code, details FROM audit.event
            WHERE subject_account_id = $1 AND (code LIKE 'version_%' OR code LIKE 'comparison_%')
            ORDER BY time, id`,
          [accountId],
        )
      ).rows,
  );
}

/** A `session` row stored past the service, as only the server's admin could. */
async function stored(
  kind: 'activate' | 'reject',
  author: string,
  adminBasis: string | null = 'owner_list',
) {
  await testDatabase.asAdmin((client) =>
    client.query(
      `INSERT INTO knowledge.decision (kind, subject_kind, route_id, version_number, content_hash,
         approver_account_id, proof, admin_basis)
       VALUES ($1, 'route', $2, $3, $4, $5, 'session', $6)`,
      [kind, version.routeId, version.number, version.hash, author, adminBasis],
    ),
  );
}

const sessionInsert = (author: string, changes = sql``) => sql`
  INSERT INTO knowledge.decision (id, kind, subject_kind, route_id, version_number, content_hash,
    approver_account_id, proof, admin_basis)
  VALUES (${randomUUID()}, 'activate', 'route', 'qm-sample', 1, ${version.hash}, ${author},
    'session', 'owner_list')${changes}`;

describe('knowledge decisions by a signed-in admin (spec 0007, R7; ADR-0027)', () => {
  it('activates with no step-up, as a session row the database times, and records the event', async () => {
    const service = decisions();
    const before = new Date();
    const outcome = await service.decide(approver.signedIn, 'activate', request);
    expect(outcome).toHaveProperty('decided');
    expect(await service.states()).toEqual(new Map([[identityKey, 'active']]));
    expect(await decisions().states()).toEqual(new Map([[identityKey, 'active']]));
    const [row, ...others] = await rows();
    expect(others).toEqual([]);
    expect(row).toMatchObject({
      id: 'decided' in outcome ? outcome.decided : '',
      kind: 'activate',
      subject_kind: 'route',
      route_id: version.routeId,
      version_number: version.number,
      content_hash: version.hash,
      approver_account_id: approver.signedIn.accountId,
      proof: 'session',
      admin_basis: 'owner_list',
      credential_id: null,
      public_key: null,
      action_nonce: null,
      server_nonce: null,
      authenticator_data: null,
      client_data_json: null,
      signature: null,
      step_up_id: null,
    });
    expect((row?.['decided_at'] as Date).getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(await decisionEvents(approver.signedIn.accountId)).toEqual([
      {
        code: 'version_activated',
        details: {
          decisionId: 'decided' in outcome ? outcome.decided : '',
          routeId: version.routeId,
          number: version.number,
        },
      },
    ]);
  });

  it('decides a comparison version as its own subject kind', async () => {
    const outcome = await decisions().decide(approver.signedIn, 'activate', comparisonTarget);
    expect(outcome).toHaveProperty('decided');
    expect(await decisions().states()).toEqual(new Map([[comparisonKey, 'active']]));
    expect(await rows()).toMatchObject([
      { subject_kind: 'comparison', route_id: null, comparison_id: comparisonSeriesId },
    ]);
    expect((await decisionEvents(approver.signedIn.accountId)).map(({ code }) => code)).toEqual([
      'comparison_activated',
    ]);
  });

  it('closes the reports of the version a correction it activates corrects (R8)', async () => {
    const correction: VersionIdentity = {
      ...version,
      number: 2,
      corrects: 1,
      hash: 'b'.repeat(64),
    };
    const service = decisions([approver.signedIn.accountId], {
      identities: (routeId) => (routeId === version.routeId ? [version, correction] : []),
    });
    const caseId = randomUUID();
    await testDatabase.asAdmin(async (client) => {
      await client.query('INSERT INTO cases.case_file (id) VALUES ($1)', [caseId]);
      await client.query('INSERT INTO cases.member (account_id, case_id) VALUES ($1, $2)', [
        approver.signedIn.accountId,
        caseId,
      ]);
      await client.query(
        `INSERT INTO cases.rule_report
           (case_id, reporter_account_id, route_id, version_number, requirement_id, reason)
         VALUES ($1, $2, 'qm-sample', 1, 'adult', 'outdated'), ($1, $2, 'qm-sample', 2, 'adult', 'other')`,
        [caseId, approver.signedIn.accountId],
      );
    });
    const outcome = await service.decide(approver.signedIn, 'activate', {
      subject: 'route',
      routeId: 'qm-sample',
      number: 2,
    });
    expect(outcome).toHaveProperty('decided');
    const states = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<{ version_number: number; state: string }>(
            'SELECT version_number, state FROM cases.rule_report WHERE case_id = $1 ORDER BY 1',
            [caseId],
          )
        ).rows,
    );
    expect(states).toEqual([
      { version_number: 1, state: 'closed' },
      { version_number: 2, state: 'open' },
    ]);
  });

  it('refuses an account not on the list, and stores and records nothing', async () => {
    const other = await person(testDatabase);
    for (const kind of ['activate', 'reject'] as const) {
      expect(await decisions().decide(other.signedIn, kind, request)).toEqual({
        refused: 'not_admin',
      });
    }
    expect(await rows()).toEqual([]);
    expect(await decisionEvents(other.signedIn.accountId)).toEqual([]);
  });

  it('refuses a version the catalog does not hold', async () => {
    expect(
      await decisions().decide(approver.signedIn, 'activate', { ...request, number: 2 }),
    ).toEqual({ refused: 'not_found' });
    expect(await rows()).toEqual([]);
  });

  it('rejects at once and for good', async () => {
    const service = decisions();
    await service.decide(approver.signedIn, 'activate', request);
    expect(await service.decide(approver.signedIn, 'reject', request)).toHaveProperty('decided');
    expect(await service.states()).toEqual(new Map([[identityKey, 'rejected']]));
    expect(await service.decide(approver.signedIn, 'activate', request)).toEqual({
      refused: 'already_rejected',
    });
    expect((await decisionEvents(approver.signedIn.accountId)).map(({ code }) => code)).toEqual([
      'version_activated',
      'version_rejected',
    ]);
  });

  it('keeps counting a session row after its author leaves the list, a rejection included', async () => {
    const service = decisions();
    await service.decide(approver.signedIn, 'activate', request);
    expect(await decisions([]).states()).toEqual(new Map([[identityKey, 'active']]));
    await service.decide(approver.signedIn, 'reject', request);
    // A rejected version never comes back because its author lost the role.
    expect(await decisions([]).states()).toEqual(new Map([[identityKey, 'rejected']]));
    expect(errors).toEqual([]);
  });
});

describe('decisions stored under ADR-0022', () => {
  const legacy = (kind: 'activate' | 'reject', who: Person = approver, changes = {}) =>
    legacyDecision(testDatabase, stepUp, who, routeAction(kind, version), changes);

  it('still count after the passkey is revoked and the step-up is gone', async () => {
    await legacy('activate');
    await testDatabase.asAdmin(async (client) => {
      await client.query('DELETE FROM auth.step_up WHERE account_id = $1', [
        approver.signedIn.accountId,
      ]);
      await client.query('DELETE FROM auth.passkey WHERE user_id = $1', [
        approver.signedIn.accountId,
      ]);
    });
    expect(await decisions().states()).toEqual(new Map([[identityKey, 'active']]));
    expect(errors).toEqual([]);
  });

  it('ignore an activation whose assertion does not verify, and log it', async () => {
    await legacy('activate', approver, { signature: randomBytes(64) });
    expect(await decisions().states()).toEqual(new Map());
    expect(errors).toEqual(['KnowledgeActivationIgnored']);
  });

  it('count a rejection even when it does not verify', async () => {
    await legacy('reject', approver, { signature: randomBytes(64) });
    expect(await decisions().states()).toEqual(new Map([[identityKey, 'rejected']]));
    expect(errors).toEqual([]);
  });

  it('ignore an activation by an account no longer on the list', async () => {
    await legacy('activate');
    expect(await decisions([]).states()).toEqual(new Map());
  });

  it('ignore a real activation copied onto another number or hash', async () => {
    await legacy('activate');
    await testDatabase.asAdmin(async (client) => {
      for (const [number, hash] of [
        [2, version.hash],
        [1, 'b'.repeat(64)],
      ] as const) {
        await client.query(
          `INSERT INTO knowledge.decision (kind, subject_kind, route_id, version_number,
             content_hash, approver_account_id, proof, credential_id, public_key, action_nonce,
             server_nonce, authenticator_data, client_data_json, signature, step_up_id)
           SELECT kind, subject_kind, route_id, $1, $2, approver_account_id, proof, credential_id,
             public_key, action_nonce, server_nonce, authenticator_data, client_data_json,
             signature, gen_random_uuid()
             FROM knowledge.decision WHERE version_number = 1 AND content_hash = $3`,
          [number, hash, version.hash],
        );
      }
    });
    expect(await decisions().states()).toEqual(new Map([[identityKey, 'active']]));
    expect(errors).toEqual(['KnowledgeActivationIgnored', 'KnowledgeActivationIgnored']);
  });

  it('never count as a session row, nor a session row as theirs', async () => {
    await legacy('activate');
    // A step_up row's fields on a session row, or a session row with none of them, are refused.
    await expect(
      testDatabase.asAdmin((client) =>
        client.query(`UPDATE knowledge.decision SET proof = 'session', admin_basis = 'owner_list'`),
      ),
    ).rejects.toThrow(/decision_proof/);
    await expect(
      testDatabase.asAdmin((client) =>
        client.query(`UPDATE knowledge.decision SET signature = NULL`),
      ),
    ).rejects.toThrow(/decision_proof/);
    await expect(
      testDatabase.asAdmin((client) =>
        client.query(`UPDATE knowledge.decision SET admin_basis = 'owner_list'`),
      ),
    ).rejects.toThrow(/decision_proof/);
    await expect(stored('activate', approver.signedIn.accountId, null)).rejects.toThrow(
      /decision_proof/,
    );
    await expect(stored('activate', approver.signedIn.accountId, 'grant')).rejects.toThrow(
      /decision_proof/,
    );
    await expect(
      testDatabase.asAdmin((client) =>
        client.query(`UPDATE knowledge.decision SET proof = 'other'`),
      ),
    ).rejects.toThrow(/decision_proof/);
  });
});

describe('who may store and change decisions (ADR-0027)', () => {
  it('lets app_auth insert only a session row by the transaction’s own account', async () => {
    const author = approver.signedIn.accountId;
    const asAuthor = (statement: ReturnType<typeof sql>, accountId = author) =>
      withIdentity(testDatabase.authDb, { accountId }, (tx) => tx.execute(statement));
    await expect(testDatabase.authDb.execute(sessionInsert(author))).rejects.toThrow();
    await expect(asAuthor(sessionInsert(author), randomUUID())).rejects.toThrow();
    await expect(
      asAuthor(sql`
        INSERT INTO knowledge.decision (id, kind, subject_kind, route_id, version_number,
          content_hash, approver_account_id, proof, credential_id, public_key, action_nonce,
          server_nonce, authenticator_data, client_data_json, signature, step_up_id)
        VALUES (${randomUUID()}, 'activate', 'route', 'qm-sample', 1, ${version.hash}, ${author},
          'step_up', 'credential', '\\x00', ${randomBytes(16)}, ${randomBytes(32)}, '\\x00', '\\x00',
          '\\x00', ${randomUUID()})`),
    ).rejects.toMatchObject(denied);
    await expect(
      asAuthor(sql`
        INSERT INTO knowledge.decision (id, kind, subject_kind, route_id, version_number,
          content_hash, approver_account_id, proof, admin_basis, decided_at)
        VALUES (${randomUUID()}, 'activate', 'route', 'qm-sample', 1, ${version.hash}, ${author},
          'session', 'owner_list', now() - interval '1 year')`),
    ).rejects.toMatchObject(denied);
    await expect(
      withIdentity(testDatabase.apiDb, { accountId: author }, (tx) =>
        tx.execute(sessionInsert(author)),
      ),
    ).rejects.toThrow();
    await expect(asAuthor(sessionInsert(author))).resolves.toBeDefined();
    expect(await decisions().states()).toEqual(new Map([[identityKey, 'active']]));
  });

  it('lets nobody change or delete a decision', async () => {
    await decisions().decide(approver.signedIn, 'reject', request);
    for (const change of [
      sql`UPDATE knowledge.decision SET kind = 'activate'`,
      sql`DELETE FROM knowledge.decision`,
    ]) {
      await expect(testDatabase.apiDb.execute(change)).rejects.toThrow();
      await expect(testDatabase.authDb.execute(change)).rejects.toThrow();
      await expect(
        withIdentity(testDatabase.authDb, { accountId: approver.signedIn.accountId }, (tx) =>
          tx.execute(change),
        ),
      ).rejects.toThrow();
    }
    expect(await decisions().states()).toEqual(new Map([[identityKey, 'rejected']]));
  });
});
