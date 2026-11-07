import { parseCalendarDate, type VersionIdentity } from '@arca/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog } from '../../src/audit/log.js';
import { credentialStore } from '../../src/auth/auth.js';
import { createStepUp } from '../../src/auth/step-up.js';
import { createKnowledgeDecisions } from '../../src/knowledge/decisions.js';
import { authTestDatabase, silentLogger, type AuthTestDatabase } from './auth-database.js';
import { legacyStepUp, routeAction } from './knowledge-decision-legacy.js';
import { origin, person } from './step-up-people.js';

// A decision stored by app_auth under ADR-0022, on the migrations before ADR-0027's, still counts
// once they run. Synthetic data only.
const sessionMigration = '20261107185543_knowledge_decision_session';
let testDatabase: AuthTestDatabase;

const version: VersionIdentity = {
  routeId: 'qm-sample',
  number: 1,
  effectiveFrom: parseCalendarDate('2026-01-01'),
  status: 'open',
  hash: 'a'.repeat(64),
};

beforeAll(async () => {
  testDatabase = await authTestDatabase({ stopBefore: sessionMigration });
});

afterAll(async () => {
  await testDatabase.drop();
});

describe('the session-decision migration (ADR-0027)', () => {
  it('keeps a decision stored under ADR-0022 counting, as a step_up row', async () => {
    const { authDb, auditDb, apiDb } = testDatabase;
    const stepUp = createStepUp({
      db: authDb,
      credentials: credentialStore(authDb),
      audit: auditLog(auditDb),
      origin,
      logger: silentLogger,
    });
    const approver = await person(testDatabase);
    const action = routeAction('activate', version);
    await legacyStepUp(stepUp, approver, action);
    // The insert ADR-0022's service ran, admitted by that migration's policy on app_auth.
    const spent = await stepUp.spend(
      approver.signedIn,
      'knowledge_decision',
      action,
      async (tx, step) => {
        await tx.execute(sql`
          INSERT INTO knowledge.decision (kind, subject_kind, route_id, version_number,
            content_hash, approver_account_id, credential_id, public_key, action_nonce,
            server_nonce, authenticator_data, client_data_json, signature, step_up_id)
          VALUES ('activate', 'route', ${version.routeId}, ${version.number}, ${version.hash},
            ${approver.signedIn.accountId}, ${step.credentialId}, ${Buffer.from(step.publicKey)},
            ${Buffer.from(action.nonce)}, ${Buffer.from(step.nonce)},
            ${Buffer.from(step.authenticatorData)}, ${Buffer.from(step.clientDataJson)},
            ${Buffer.from(step.signature)}, ${step.id})`);
      },
    );
    expect(spent).toBe(true);

    await testDatabase.migrateRest();

    const errors: string[] = [];
    const decisions = createKnowledgeDecisions({
      db: apiDb,
      authDb: () => authDb,
      audit: auditLog(auditDb),
      catalog: { identities: (routeId) => (routeId === version.routeId ? [version] : []) },
      comparisons: { identities: () => [] },
      approvers: [approver.signedIn.accountId],
      origin,
      logger: {
        info: () => undefined,
        error: ({ errorName }) => {
          errors.push(String(errorName));
        },
      },
    });
    expect(await decisions.states()).toEqual(new Map([[`qm-sample/1/${version.hash}`, 'active']]));
    expect(errors).toEqual([]);
    const proofs = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<{ proof: string; admin_basis: string | null }>(
            'SELECT proof, admin_basis FROM knowledge.decision',
          )
        ).rows,
    );
    expect(proofs).toEqual([{ proof: 'step_up', admin_basis: null }]);
  });
});
