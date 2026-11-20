import { versionCasesHash } from '@arca/knowledge';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postgresRuleStore } from '../../src/knowledge/rule-store.js';
import { authTestDatabase, type AuthTestDatabase, silentLogger } from './auth-database.js';

// Session reviews on the real migrations (ADR-0032): each activation a review's migration stored
// names a version the API reads, under the content and cases hashes it reads now.
let testDatabase: AuthTestDatabase;

beforeAll(async () => {
  testDatabase = await authTestDatabase();
}, 60_000);

afterAll(async () => {
  await testDatabase.drop();
});

describe('session review activations (ADR-0032)', () => {
  it('name stored versions by the hashes the rule store reads', async () => {
    const store = postgresRuleStore(() => testDatabase.apiDb, silentLogger);
    const data = await store.data();
    const { catalog } = await store.engine();
    const activations = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<{
            route_id: string;
            version_number: number;
            content_hash: string;
            cases_hash: string;
          }>(
            `SELECT route_id, version_number, content_hash, cases_hash FROM knowledge.decision
              WHERE proof = 'session_review' ORDER BY route_id, version_number`,
          )
        ).rows,
    );
    expect(activations.map((row) => `${row.route_id}/${String(row.version_number)}`)).toContain(
      'us-eb5/9',
    );
    for (const row of activations) {
      const identity = catalog
        .identities(row.route_id)
        .find(({ number }) => number === row.version_number);
      expect(identity?.hash, row.route_id).toBe(row.content_hash);
      expect(versionCasesHash(data, row.content_hash), row.route_id).toBe(row.cases_hash);
    }
  });
});
