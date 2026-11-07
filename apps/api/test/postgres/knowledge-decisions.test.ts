import { randomBytes, randomUUID } from 'node:crypto';
import { decideComparisonAction, decideVersionAction } from '@arca/api-contract/routes';
import { withIdentity } from '@arca/db';
import {
  type ComparisonIdentity,
  comparisonIdentityKey,
  parseCalendarDate,
  selectComparisonVersion,
  type VersionIdentity,
} from '@arca/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog } from '../../src/audit/log.js';
import { credentialStore } from '../../src/auth/auth.js';
import { createStepUp } from '../../src/auth/step-up.js';
import type { CanonicalAction } from '../../src/auth/step-up-encoding.js';
import {
  createKnowledgeDecisions,
  type KnowledgeDecisions,
} from '../../src/knowledge/decisions.js';
import { authTestDatabase, silentLogger, type AuthTestDatabase } from './auth-database.js';
import { ceremony, origin, person, type Person, toRequest } from './step-up-people.js';

// Knowledge decisions on the real migrations (spec 0007, R7). Synthetic data only.
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
const comparisonVersions: readonly ComparisonIdentity[] = [
  { comparisonId: 'destinations', number: 1, hash: 'c'.repeat(64) },
  { comparisonId: 'destinations', number: 2, hash: 'd'.repeat(64) },
];
const comparisons = { identities: () => comparisonVersions };

function decisions(
  approvers: readonly string[] = [approver.signedIn.accountId],
  identities: typeof catalog = catalog,
): KnowledgeDecisions {
  return createKnowledgeDecisions({
    db: testDatabase.apiDb,
    stepUp,
    audit: auditLog(testDatabase.auditDb),
    catalog: identities,
    comparisons,
    approvers,
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

const decided = (
  kind: 'activate' | 'reject',
  contentHash = version.hash,
  nonce: Uint8Array = randomBytes(16),
): CanonicalAction => ({
  ...decideVersionAction(
    kind === 'activate' ? 'activateVersion' : 'rejectVersion',
    { routeId: version.routeId, number: version.number },
    contentHash,
  ),
  nonce,
});

/** A verified knowledge_decision step-up for the action; returns its action nonce. */
async function approved(who: Person, action: CanonicalAction) {
  const { verified } = await ceremony(stepUp, who, toRequest('knowledge_decision', action));
  expect(verified).toBe(true);
  return action.nonce;
}

const request = { subject: 'route', routeId: version.routeId, number: version.number } as const;

async function forged(kind: 'activate' | 'reject') {
  await testDatabase.asAdmin((client) =>
    client.query(
      `INSERT INTO knowledge.decision (kind, subject_kind, route_id, version_number, content_hash,
         approver_account_id, credential_id, public_key, action_nonce, server_nonce,
         authenticator_data, client_data_json, signature, step_up_id)
       VALUES ($1, 'route', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        kind,
        version.routeId,
        version.number,
        version.hash,
        approver.signedIn.accountId,
        approver.passkey.credentialId,
        Buffer.from(approver.passkey.publicKey, 'base64'),
        randomBytes(16),
        randomBytes(32),
        randomBytes(37),
        Buffer.from('{}'),
        randomBytes(64),
        randomUUID(),
      ],
    ),
  );
}

async function decisionEvents(accountId: string) {
  return testDatabase.asAdmin(
    async (client) =>
      (
        await client.query<{ code: string; details: Record<string, unknown> }>(
          'SELECT code, details FROM audit.event WHERE subject_account_id = $1 AND code LIKE $2',
          [accountId, 'version_%'],
        )
      ).rows,
  );
}

describe('knowledge decisions (spec 0007, R7)', () => {
  it('activates with a step-up bound to the catalog hash, and records the decision', async () => {
    const service = decisions();
    const nonce = await approved(approver, decided('activate'));
    const outcome = await service.decide(approver.signedIn, 'activate', request, nonce);
    expect(outcome).toHaveProperty('decided');
    expect([...(await service.states())]).toEqual([[identityKey, 'active']]);
    expect(await decisions().states()).toEqual(new Map([[identityKey, 'active']]));
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
    const action: CanonicalAction = {
      ...decideVersionAction(
        'activateVersion',
        { routeId: 'qm-sample', number: 2 },
        correction.hash,
      ),
      nonce: randomBytes(16),
    };
    const nonce = await approved(approver, action);
    const outcome = await service.decide(
      approver.signedIn,
      'activate',
      { subject: 'route', routeId: 'qm-sample', number: 2 },
      nonce,
    );
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

  it('refuses an account not on the list, and stores nothing', async () => {
    const other = await person(testDatabase);
    const nonce = await approved(other, decided('activate'));
    expect(await decisions().decide(other.signedIn, 'activate', request, nonce)).toEqual({
      refused: 'not_approver',
    });
    expect(await decisions().states()).toEqual(new Map());
  });

  it('refuses a step-up bound to another hash, kind or nonce', async () => {
    const service = decisions();
    const nonce = randomBytes(16);
    await approved(approver, decided('activate', 'b'.repeat(64), nonce));
    await approved(approver, decided('reject', version.hash, nonce));
    await approved(approver, decided('activate'));
    expect(await service.decide(approver.signedIn, 'activate', request, nonce)).toEqual({
      refused: 'step_up_required',
    });
    expect(await service.states()).toEqual(new Map());
  });

  it('leaves the step-up unspent when storing the decision fails', async () => {
    const action = decided('activate');
    await approved(approver, action);
    await expect(
      stepUp.spend(approver.signedIn, 'knowledge_decision', action, () =>
        Promise.reject(new Error('storage failed')),
      ),
    ).rejects.toThrow('storage failed');
    expect(
      await decisions().decide(approver.signedIn, 'activate', request, action.nonce),
    ).toHaveProperty('decided');
  });

  it('admits on app_auth only an exact copy of a spent knowledge_decision step-up', async () => {
    await approved(approver, decided('activate'));
    const [spent] = (
      await testDatabase.asAdmin((client) =>
        client.query<{
          id: string;
          credential_id: string;
          nonce: Buffer;
          authenticator_data: Buffer;
          client_data_json: Buffer;
          signature: Buffer;
        }>('SELECT * FROM auth.step_up WHERE account_id = $1', [approver.signedIn.accountId]),
      )
    ).rows;
    if (spent === undefined) throw new Error('no step-up');
    const insert = (changes: Partial<Record<string, unknown>> = {}) => {
      const row = {
        account: approver.signedIn.accountId,
        credential: spent.credential_id,
        signature: spent.signature,
        ...changes,
      };
      return testDatabase.authDb.execute(sql`
        INSERT INTO knowledge.decision (id, kind, subject_kind, route_id, version_number,
          content_hash, approver_account_id, credential_id, public_key, action_nonce, server_nonce,
          authenticator_data, client_data_json, signature, step_up_id)
        VALUES (${randomUUID()}, 'activate', 'route', 'qm-sample', 1, ${version.hash}, ${row.account},
          ${row.credential}, '\\x00', ${randomBytes(16)}, ${spent.nonce},
          ${spent.authenticator_data}, ${spent.client_data_json}, ${row.signature}, ${spent.id})`);
    };
    await expect(insert()).rejects.toThrow();
    await testDatabase.asAdmin((client) =>
      client.query('UPDATE auth.step_up SET consumed_at = now() WHERE id = $1', [spent.id]),
    );
    await expect(insert({ account: randomUUID() })).rejects.toThrow();
    await expect(insert({ credential: 'another' })).rejects.toThrow();
    await expect(insert({ signature: randomBytes(64) })).rejects.toThrow();
    await testDatabase.asAdmin((client) =>
      client.query(`UPDATE auth.step_up SET purpose = 'data_export' WHERE id = $1`, [spent.id]),
    );
    await expect(insert()).rejects.toThrow();
    await testDatabase.asAdmin((client) =>
      client.query(`UPDATE auth.step_up SET purpose = 'knowledge_decision' WHERE id = $1`, [
        spent.id,
      ]),
    );
    await expect(insert()).resolves.toBeDefined();
  });

  it('refuses a step-up spent before', async () => {
    const service = decisions();
    const nonce = await approved(approver, decided('activate'));
    await service.decide(approver.signedIn, 'activate', request, nonce);
    expect(await service.decide(approver.signedIn, 'activate', request, nonce)).toEqual({
      refused: 'step_up_required',
    });
  });

  it('refuses a version the catalog does not hold', async () => {
    const nonce = await approved(approver, decided('activate'));
    expect(
      await decisions().decide(approver.signedIn, 'activate', { ...request, number: 2 }, nonce),
    ).toEqual({ refused: 'not_found' });
  });

  it('rejects at once and for good', async () => {
    const service = decisions();
    await service.decide(
      approver.signedIn,
      'activate',
      request,
      await approved(approver, decided('activate')),
    );
    const rejection = await service.decide(
      approver.signedIn,
      'reject',
      request,
      await approved(approver, decided('reject')),
    );
    expect(rejection).toHaveProperty('decided');
    expect(await service.states()).toEqual(new Map([[identityKey, 'rejected']]));
    const nonce = await approved(approver, decided('activate'));
    expect(await service.decide(approver.signedIn, 'activate', request, nonce)).toEqual({
      refused: 'already_rejected',
    });
    expect((await decisionEvents(approver.signedIn.accountId)).map(({ code }) => code)).toEqual([
      'version_activated',
      'version_rejected',
    ]);
  });

  it('still verifies a decision after its passkey is revoked and its step-up is gone', async () => {
    await decisions().decide(
      approver.signedIn,
      'activate',
      request,
      await approved(approver, decided('activate')),
    );
    await testDatabase.asAdmin(async (client) => {
      await client.query('DELETE FROM auth.step_up WHERE account_id = $1', [
        approver.signedIn.accountId,
      ]);
      await client.query('DELETE FROM auth.passkey WHERE user_id = $1', [
        approver.signedIn.accountId,
      ]);
    });
    expect(await decisions().states()).toEqual(new Map([[identityKey, 'active']]));
  });

  it('ignores a forged activation and logs it', async () => {
    await forged('activate');
    expect(await decisions().states()).toEqual(new Map());
    expect(errors).toEqual(['KnowledgeActivationIgnored']);
  });

  it('counts a forged rejection', async () => {
    await forged('reject');
    expect(await decisions().states()).toEqual(new Map([[identityKey, 'rejected']]));
    expect(errors).toEqual([]);
  });

  it('ignores an activation by an account no longer on the list', async () => {
    await decisions().decide(
      approver.signedIn,
      'activate',
      request,
      await approved(approver, decided('activate')),
    );
    expect(await decisions([]).states()).toEqual(new Map());
  });

  it('ignores a real activation copied onto another number or hash', async () => {
    await decisions().decide(
      approver.signedIn,
      'activate',
      request,
      await approved(approver, decided('activate')),
    );
    await testDatabase.asAdmin(async (client) => {
      for (const [number, hash] of [
        [2, version.hash],
        [1, 'b'.repeat(64)],
      ] as const) {
        await client.query(
          `INSERT INTO knowledge.decision (kind, subject_kind, route_id, version_number,
             content_hash, approver_account_id, credential_id, public_key, action_nonce,
             server_nonce, authenticator_data, client_data_json, signature, step_up_id)
           SELECT kind, subject_kind, route_id, $1, $2, approver_account_id, credential_id, public_key,
             action_nonce, server_nonce, authenticator_data, client_data_json, signature,
             gen_random_uuid()
             FROM knowledge.decision WHERE version_number = 1 AND content_hash = $3`,
          [number, hash, version.hash],
        );
      }
    });
    expect(await decisions().states()).toEqual(new Map([[identityKey, 'active']]));
    expect(errors).toEqual(['KnowledgeActivationIgnored', 'KnowledgeActivationIgnored']);
  });

  it('lets only app_auth insert, only a copy of a spent step-up, and nobody change a decision', async () => {
    await forged('reject');
    const row = sql`
      INSERT INTO knowledge.decision (id, kind, subject_kind, route_id, version_number,
        content_hash, approver_account_id, credential_id, public_key, action_nonce, server_nonce,
        authenticator_data, client_data_json, signature, step_up_id)
      VALUES (${randomUUID()}, 'activate', 'route', 'qm-sample', 1, ${version.hash},
        ${approver.signedIn.accountId}, ${approver.passkey.credentialId}, '\\x00',
        ${randomBytes(16)}, ${randomBytes(32)}, '\\x00', '\\x00', '\\x00', ${randomUUID()})`;
    await expect(
      withIdentity(testDatabase.apiDb, { accountId: approver.signedIn.accountId }, (tx) =>
        tx.execute(row),
      ),
    ).rejects.toThrow();
    await expect(testDatabase.authDb.execute(row)).rejects.toThrow();
    for (const change of [
      sql`UPDATE knowledge.decision SET kind = 'activate'`,
      sql`DELETE FROM knowledge.decision`,
    ]) {
      await expect(testDatabase.apiDb.execute(change)).rejects.toThrow();
      await expect(testDatabase.authDb.execute(change)).rejects.toThrow();
    }
    expect(await decisions().states()).toEqual(new Map([[identityKey, 'rejected']]));
  });
});

describe('decisions on comparison versions (ADR-0026)', () => {
  const [first, second] = comparisonVersions as [ComparisonIdentity, ComparisonIdentity];
  const target = (identity: ComparisonIdentity) =>
    ({
      subject: 'comparison',
      comparisonId: identity.comparisonId,
      number: identity.number,
    }) as const;
  const comparisonAction = (
    kind: 'activate' | 'reject',
    identity: ComparisonIdentity = first,
    nonce: Uint8Array = randomBytes(16),
  ): CanonicalAction => ({
    ...decideComparisonAction(
      kind === 'activate' ? 'activateComparison' : 'rejectComparison',
      target(identity),
      identity.hash,
    ),
    nonce,
  });
  const decide = async (
    service: KnowledgeDecisions,
    kind: 'activate' | 'reject',
    identity: ComparisonIdentity,
  ) =>
    service.decide(
      approver.signedIn,
      kind,
      target(identity),
      await approved(approver, comparisonAction(kind, identity)),
    );

  it('activates with its own step-up action, keyed apart from routes, and records it', async () => {
    const service = decisions();
    const outcome = await decide(service, 'activate', first);
    expect(outcome).toHaveProperty('decided');
    expect(await decisions().states()).toEqual(new Map([[comparisonIdentityKey(first), 'active']]));
    const events = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<{ code: string; details: Record<string, unknown> }>(
            'SELECT code, details FROM audit.event WHERE subject_account_id = $1 AND code LIKE $2',
            [approver.signedIn.accountId, 'comparison_%'],
          )
        ).rows,
    );
    expect(events).toEqual([
      {
        code: 'comparison_activated',
        details: {
          decisionId: 'decided' in outcome ? outcome.decided : '',
          comparisonId: 'destinations',
          number: 1,
        },
      },
    ]);
    const [row] = (
      await testDatabase.asAdmin((client) =>
        client.query<{ subject_kind: string; route_id: string | null; comparison_id: string }>(
          'SELECT subject_kind, route_id, comparison_id FROM knowledge.decision',
        ),
      )
    ).rows;
    expect(row).toEqual({
      subject_kind: 'comparison',
      route_id: null,
      comparison_id: 'destinations',
    });
  });

  it('refuses a route step-up for a comparison, and a comparison step-up for a route', async () => {
    const service = decisions();
    const nonce = randomBytes(16);
    await approved(approver, {
      ...decideVersionAction('activateVersion', { routeId: 'destinations', number: 1 }, first.hash),
      nonce,
    });
    expect(await service.decide(approver.signedIn, 'activate', target(first), nonce)).toEqual({
      refused: 'step_up_required',
    });
    const comparisonNonce = randomBytes(16);
    await approved(approver, comparisonAction('activate', first, comparisonNonce));
    expect(await service.decide(approver.signedIn, 'activate', request, comparisonNonce)).toEqual({
      refused: 'step_up_required',
    });
    expect(await service.states()).toEqual(new Map());
  });

  it('decides only a hash from the comparison catalog', async () => {
    const nonce = await approved(approver, comparisonAction('activate'));
    expect(
      await decisions().decide(
        approver.signedIn,
        'activate',
        { subject: 'comparison', comparisonId: 'homicides', number: 1 },
        nonce,
      ),
    ).toEqual({ refused: 'not_found' });
    expect(
      await decisions().decide(
        approver.signedIn,
        'activate',
        { ...target(first), number: 3 },
        nonce,
      ),
    ).toEqual({ refused: 'not_found' });
  });

  it('keeps the previous active version in use when the newest is rejected', async () => {
    const service = decisions();
    await decide(service, 'activate', first);
    await decide(service, 'activate', second);
    expect(selectComparisonVersion(comparisonVersions, await service.states()).active).toEqual(
      second,
    );
    expect(await decide(service, 'reject', second)).toHaveProperty('decided');
    const states = await service.states();
    expect(selectComparisonVersion(comparisonVersions, states)).toEqual({
      active: first,
      pendingNewer: false,
    });
    const nonce = await approved(approver, comparisonAction('activate', second));
    expect(await service.decide(approver.signedIn, 'activate', target(second), nonce)).toEqual({
      refused: 'already_rejected',
    });
  });

  it('never counts a route-signed activation stored as a comparison decision', async () => {
    const service = decisions();
    await service.decide(
      approver.signedIn,
      'activate',
      request,
      await approved(approver, decided('activate')),
    );
    const copy = (subject: string, routeId: string | null, comparisonId: string | null) =>
      testDatabase.asAdmin((client) =>
        client.query(
          `INSERT INTO knowledge.decision (kind, subject_kind, route_id, comparison_id,
             version_number, content_hash, approver_account_id, credential_id, public_key,
             action_nonce, server_nonce, authenticator_data, client_data_json, signature,
             step_up_id)
           SELECT kind, $1, $2, $3, version_number, content_hash, approver_account_id,
             credential_id, public_key, action_nonce, server_nonce, authenticator_data,
             client_data_json, signature, gen_random_uuid()
             FROM knowledge.decision WHERE route_id = 'qm-sample'`,
          [subject, routeId, comparisonId],
        ),
      );
    await copy('comparison', null, 'destinations');
    expect(await decisions().states()).toEqual(new Map([[identityKey, 'active']]));
    expect(errors).toEqual(['KnowledgeActivationIgnored']);
    // Each kind keeps its own shape: no route ID on a comparison row, only the one series.
    await expect(copy('comparison', 'qm-sample', 'destinations')).rejects.toThrow();
    await expect(copy('comparison', null, 'homicides')).rejects.toThrow();
    await expect(copy('comparison', null, null)).rejects.toThrow();
    await expect(copy('route', 'qm-sample', 'destinations')).rejects.toThrow();
    await expect(copy('route', null, null)).rejects.toThrow();
    await expect(copy('other', 'qm-sample', null)).rejects.toThrow();
  });
});
