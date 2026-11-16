import { identityKey, parseCalendarDate } from '@arca/domain';
import { bundledRuleData, routeCatalog, routeIds } from '@arca/knowledge/bundled';
import type { Logger } from '@arca/telemetry';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postgresRuleStore } from '../../src/knowledge/rule-store.js';
import { createKnowledgeVersions } from '../../src/knowledge/versions.js';
import { authTestDatabase, type AuthTestDatabase, silentLogger } from './auth-database.js';

// The rules the API reads from the database (ADR-0031), on the real migrations, whose import
// wrote the repository's rules: the same versions, hashes and views as the bundle held.
let testDatabase: AuthTestDatabase;

beforeAll(async () => {
  testDatabase = await authTestDatabase();
}, 60_000);

afterAll(async () => {
  await testDatabase.drop();
});

const states = new Map(
  routeIds.flatMap((routeId) =>
    routeCatalog.identities(routeId).map((identity) => [identityKey(identity), 'active' as const]),
  ),
);

describe('the rule store (ADR-0031)', () => {
  it('reads every imported version with the hash, cases and hosts the bundle held', async () => {
    const store = postgresRuleStore(() => testDatabase.apiDb, silentLogger);
    const data = await store.data();
    expect(data.refused).toEqual([]);
    expect(new Map(data.entries)).toEqual(new Map(bundledRuleData.entries));
    expect(new Map(data.cases.map(({ hash, cases }) => [hash, cases]))).toEqual(
      new Map(bundledRuleData.cases.map(({ hash, cases }) => [hash, cases])),
    );
    expect(data.hosts).toEqual(bundledRuleData.hosts);
    const engine = await store.engine();
    expect(engine.routeIds).toEqual(routeIds);
    for (const routeId of routeIds) {
      expect(engine.catalog.identities(routeId)).toEqual(routeCatalog.identities(routeId));
    }
  });

  it('shows the activation screen the same versions and states as before', async () => {
    const store = postgresRuleStore(() => testDatabase.apiDb, silentLogger);
    const settings = {
      states: () => Promise.resolve(states),
      today: () => parseCalendarDate('2026-11-16'),
    };
    const fromDatabase = createKnowledgeVersions({ ...settings, rules: store.data });
    const fromBundle = createKnowledgeVersions({
      ...settings,
      rules: () => Promise.resolve(bundledRuleData),
    });
    expect(await fromDatabase.list()).toEqual(await fromBundle.list());
    const [first] = routeIds;
    if (first === undefined) throw new Error('No route');
    expect(await fromDatabase.view(first, 1)).toEqual(await fromBundle.view(first, 1));
  });

  it('reads the rows again only once one is added, and leaves out and logs a changed row', async () => {
    const logged: unknown[] = [];
    const logger: Logger = { info: () => undefined, error: (entry) => logged.push(entry) };
    const store = postgresRuleStore(() => testDatabase.apiDb, logger);
    const first = await store.data();
    expect(await store.data()).toBe(first);
    const [row] = bundledRuleData.entries.values();
    if (row === undefined) throw new Error('No version');
    const { routeId, number } = row.identity;
    // Behind the grants, as only an owner connection could: a copy of a version with a new title.
    await testDatabase.asAdmin(async (client) => {
      await client.query(`ALTER TABLE knowledge.route_version DISABLE ROW LEVEL SECURITY`);
      await client.query(
        `INSERT INTO knowledge.route_version (route_id, number, content, content_hash)
         SELECT route_id, 999, jsonb_set(jsonb_set(content, '{number}', '999'), '{title}', '"Changed"'),
                content_hash
           FROM knowledge.route_version WHERE route_id = $1 AND number = $2`,
        [routeId, number],
      );
      await client.query(`ALTER TABLE knowledge.route_version ENABLE ROW LEVEL SECURITY`);
    });
    const after = await store.data();
    expect(after).not.toBe(first);
    expect(after.refused).toEqual([`routes/${routeId}/999`]);
    expect(after.entries.size).toBe(first.entries.size);
    expect(logged).toEqual([{ errorName: 'KnowledgeRowRefused' }]);
  });
});
