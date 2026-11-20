import { identityKey, parseCalendarDate } from '@arca/domain';
import { bundledRuleData, routeCatalog, routeIds, ruleContent } from '@arca/knowledge/bundled';
import type { Logger } from '@arca/telemetry';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postgresRuleStore } from '../../src/knowledge/rule-store.js';
import { createKnowledgeVersions } from '../../src/knowledge/versions.js';
import { authTestDatabase, type AuthTestDatabase, silentLogger } from './auth-database.js';

// The rules the API reads from the database (ADR-0031), on the real migrations up to the first
// session review (ADR-0032), which adds versions the bundle never held: the import wrote the
// repository's rules, the same versions, hashes and views as the bundle held.
let testDatabase: AuthTestDatabase;

beforeAll(async () => {
  testDatabase = await authTestDatabase({
    stopBefore: '20261120021314_knowledge_session_review_2026_11_us',
  });
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
    const data = ruleContent(await store.data());
    const bundled = ruleContent(bundledRuleData);
    expect(data.refused).toEqual([]);
    expect(new Map(data.entries)).toEqual(new Map(bundled.entries));
    expect(new Map(data.cases.map(({ hash, cases }) => [hash, cases]))).toEqual(
      new Map(bundled.cases.map(({ hash, cases }) => [hash, cases])),
    );
    expect(data.hosts).toEqual(bundled.hosts);
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

  it("reads the rows again only once one is added, and withholds and logs a changed row's route", async () => {
    const logged: unknown[] = [];
    const logger: Logger = { info: () => undefined, error: (entry) => logged.push(entry) };
    const store = postgresRuleStore(() => testDatabase.apiDb, logger);
    const first = await store.data();
    expect(await store.data()).toBe(first);
    const [row] = ruleContent(bundledRuleData).entries.values();
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
    const versions = routeCatalog.identities(routeId);
    expect(new Set(ruleContent(after).refused)).toEqual(
      new Set(
        [999, ...versions.map((each) => each.number)].map((n) => `routes/${routeId}/${String(n)}`),
      ),
    );
    expect(ruleContent(after).entries.size).toBe(ruleContent(first).entries.size - versions.length);
    expect((await store.engine()).routeIds).not.toContain(routeId);
    expect(logged).toEqual([{ errorName: 'KnowledgeRowRefused' }]);
  });

  it('refuses, on a fresh read, a version changed in place behind the grants', async () => {
    const [row] = ruleContent(bundledRuleData).entries.values();
    if (row === undefined) throw new Error('No version');
    const { routeId, number } = row.identity;
    await testDatabase.asAdmin(async (client) => {
      await client.query(`ALTER TABLE knowledge.route_version DISABLE ROW LEVEL SECURITY`);
      await client.query(
        `UPDATE knowledge.route_version SET content = jsonb_set(content, '{title}', '"Changed"')
          WHERE route_id = $1 AND number = $2`,
        [routeId, number],
      );
      await client.query(`ALTER TABLE knowledge.route_version ENABLE ROW LEVEL SECURITY`);
    });
    const data = ruleContent(
      await postgresRuleStore(() => testDatabase.apiDb, silentLogger).data(),
    );
    expect(data.refused).toContain(`routes/${routeId}/${String(number)}`);
    expect([...data.entries.values()].some(({ identity }) => identity.routeId === routeId)).toBe(
      false,
    );
  });
});
