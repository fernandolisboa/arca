import { randomBytes, randomUUID } from 'node:crypto';
import { decideVersionAction } from '@arca/api-contract/routes';
import { withIdentity } from '@arca/db';
import { parseCalendarDate, type VersionIdentity } from '@arca/domain';
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

function decisions(
  approvers: readonly string[] = [approver.signedIn.accountId],
): KnowledgeDecisions {
  return createKnowledgeDecisions({
    db: testDatabase.apiDb,
    stepUp,
    audit: auditLog(testDatabase.auditDb),
    catalog,
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

const request = { routeId: version.routeId, number: version.number };

async function forged(kind: 'activate' | 'reject') {
  await testDatabase.asAdmin((client) =>
    client.query(
      `INSERT INTO knowledge.decision (kind, route_id, version_number, content_hash, approver_account_id,
         credential_id, public_key, action_nonce, server_nonce, authenticator_data, client_data_json,
         signature, step_up_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
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
        details: { decisionId: 'decided' in outcome ? outcome.decided : '', ...request },
      },
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
      refused: 'version_rejected',
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

  it("lets app_api insert only the request account's decisions, and never change one", async () => {
    await forged('reject');
    const other = randomUUID();
    const attempt = (statement: ReturnType<typeof sql>) =>
      withIdentity(testDatabase.apiDb, { accountId: other }, (tx) => tx.execute(statement));
    await expect(
      attempt(sql`
        INSERT INTO knowledge.decision (kind, route_id, version_number, content_hash,
          approver_account_id, credential_id, public_key, action_nonce, server_nonce,
          authenticator_data, client_data_json, signature, step_up_id)
        VALUES ('activate', 'qm-sample', 1, ${version.hash}, ${approver.signedIn.accountId}, 'c',
          '\\x00', ${randomBytes(16)}, ${randomBytes(32)}, '\\x00', '\\x00', '\\x00', ${randomUUID()})`),
    ).rejects.toThrow();
    await expect(attempt(sql`UPDATE knowledge.decision SET kind = 'activate'`)).rejects.toThrow();
    await expect(attempt(sql`DELETE FROM knowledge.decision`)).rejects.toThrow();
    expect(await decisions().states()).toEqual(new Map([[identityKey, 'rejected']]));
  });
});
