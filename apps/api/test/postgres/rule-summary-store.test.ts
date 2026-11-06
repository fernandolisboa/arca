import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postgresSummaryStore, type SummaryKey } from '../../src/knowledge/summary/store.js';
import { authTestDatabase, type AuthTestDatabase } from './auth-database.js';

// Stored rule summaries on the real migrations (ADR-0025). Synthetic data only.
let testDatabase: AuthTestDatabase;

const key: SummaryKey = {
  contentHash: 'b'.repeat(64),
  promptVersion: 'rule-summary-2',
  model: 'claude-test',
};
const summary = { overview: 'Um resumo.', watchPoints: ['Confira o valor.', 'Confira a data.'] };

beforeAll(async () => {
  testDatabase = await authTestDatabase();
}, 60_000);

afterAll(async () => {
  await testDatabase.drop();
});

describe('knowledge.rule_summary (ADR-0025)', () => {
  it('keeps the first summary per content, prompt and model on the app_api pool', async () => {
    const store = postgresSummaryStore(() => testDatabase.apiDb);
    expect(await store.find(key)).toBeUndefined();
    await store.save(key, summary);
    await store.save(key, { overview: 'Outro.', watchPoints: [] });
    expect(await store.find(key)).toEqual(summary);
    expect(await store.find({ ...key, model: 'claude-other' })).toBeUndefined();
    expect(await store.find({ ...key, promptVersion: 'rule-summary-3' })).toBeUndefined();
  });

  it('refuses a malformed row', async () => {
    const store = postgresSummaryStore(() => testDatabase.apiDb);
    const bad: [SummaryKey, typeof summary][] = [
      [{ ...key, contentHash: 'not-a-hash' }, summary],
      [{ ...key, model: 'Claude Test' }, summary],
      [
        { ...key, model: 'claude-long' },
        { overview: 'x'.repeat(1_501), watchPoints: [] },
      ],
      [
        { ...key, model: 'claude-many' },
        { overview: 'x', watchPoints: Array.from({ length: 9 }, () => 'y') },
      ],
    ];
    for (const [badKey, badSummary] of bad) {
      await expect(store.save(badKey, badSummary)).rejects.toThrow();
    }
  });

  it('lets app_api only read and insert, and no other runtime role touch it', async () => {
    await postgresSummaryStore(() => testDatabase.apiDb).save(
      { ...key, model: 'claude-kept' },
      summary,
    );
    for (const change of [
      sql`UPDATE knowledge.rule_summary SET overview = 'Mudado.'`,
      sql`DELETE FROM knowledge.rule_summary`,
    ]) {
      await expect(testDatabase.apiDb.execute(change)).rejects.toThrow();
    }
    for (const db of [testDatabase.authDb, testDatabase.auditDb, testDatabase.jobsDb]) {
      await expect(db.execute(sql`SELECT 1 FROM knowledge.rule_summary`)).rejects.toThrow();
    }
    expect(await postgresSummaryStore(() => testDatabase.apiDb).find(key)).toEqual(summary);
  });
});
