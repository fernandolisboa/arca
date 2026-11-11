import { randomUUID } from 'node:crypto';
import type { ReportKey } from '@arca/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postgresCheckProgressStore } from '../../src/knowledge/check/progress.js';
import { postgresCheckStarts } from '../../src/knowledge/check/starts.js';
import { type NewCheckReport, postgresCheckReportStore } from '../../src/knowledge/check/store.js';
import { authTestDatabase, type AuthTestDatabase } from './auth-database.js';

// Check starts and reports on the real migrations (ADR-0027). Synthetic routes only.
let testDatabase: AuthTestDatabase;

beforeAll(async () => {
  testDatabase = await authTestDatabase();
}, 60_000);

afterAll(async () => {
  await testDatabase.drop();
});

const key: ReportKey = {
  contentHash: 'c'.repeat(64),
  guideHash: 'none',
  promptVersion: 'check-1',
  model: 'claude-test',
};
const law = 'https://www.gov.example/law';
const matches = {
  key: 'requirement:means',
  status: 'matches' as const,
  quotes: [{ quote: 'means of at least EUR 920', url: law }],
  note: null,
  reason: null,
};

const report = (patch: Partial<NewCheckReport> = {}): NewCheckReport => ({
  startId: randomUUID(),
  routeId: 'qm-sample',
  number: 1,
  ...key,
  items: [matches],
  fetchLog: [
    {
      url: law,
      machineReadableUrl: 'https://api.gov.example/law.json',
      outcome: 'read',
      status: 200,
      durationMs: 12,
      sha256: 'a'.repeat(64),
      cut: false,
    },
  ],
  failure: null,
  failed: false,
  clean: true,
  ...patch,
});

const clearStarts = () =>
  testDatabase.asAdmin((client) => client.query('TRUNCATE knowledge.check_start'));

describe('knowledge.check_start (ADR-0027)', () => {
  it('records a start per version due and none twice while it is live', async () => {
    await clearStarts();
    const starts = postgresCheckStarts(() => testDatabase.apiDb);
    const requests = [1, 2].map((number) => ({ routeId: 'qm-starts', number, key }));
    const first = await starts.begin(requests);
    expect(first.map(({ number }) => number)).toEqual([1, 2]);
    expect(await starts.begin(requests)).toEqual([]);
    expect((await starts.recent()).map(({ id }) => id).sort()).toEqual(
      first.map(({ id }) => id).sort(),
    );
  });

  it('never passes 15 automatic starts and 20 in all in 24 hours, even from concurrent screens', async () => {
    await clearStarts();
    const starts = postgresCheckStarts(() => testDatabase.apiDb);
    const requests = Array.from({ length: 30 }, (_, index) => ({
      routeId: 'qm-cap',
      number: index + 1,
      key,
    }));
    const started = (await Promise.all([1, 2, 3].map(() => starts.begin(requests)))).flat();
    expect(started).toHaveLength(15);
    expect(new Set(started.map(({ number }) => number)).size).toBe(15);
    // An admin's own starts use the 5 the automatic share leaves, and then the cap holds.
    const asked = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        starts.request({ routeId: 'qm-cap', number: 40 + index }),
      ),
    );
    expect(asked.filter((each) => each?.began === true)).toHaveLength(5);
    expect(asked.filter((each) => each === undefined)).toHaveLength(3);
    expect(await starts.recent()).toHaveLength(20);
  });

  it('answers a version its live start when asked again, also from concurrent taps', async () => {
    await clearStarts();
    const starts = postgresCheckStarts(() => testDatabase.apiDb);
    const version = { routeId: 'qm-asked', number: 1 };
    const asked = await Promise.all([1, 2, 3].map(() => starts.request(version)));
    expect(asked.filter((each) => each?.began === true)).toHaveLength(1);
    expect(new Set(asked.map((each) => each?.start.id)).size).toBe(1);
    // Its report ends the start, so the next request begins another whatever the report says.
    const [first] = asked;
    await postgresCheckReportStore(() => testDatabase.jobsDb).save(
      report({ startId: first?.start.id ?? '', routeId: 'qm-asked' }),
    );
    expect(await starts.request(version)).toMatchObject({ began: true });
    expect(await starts.recent()).toHaveLength(2);
  });

  it('lets app_api only read and insert starts, and no other runtime role touch them', async () => {
    for (const change of [
      sql`UPDATE knowledge.check_start SET version_number = 9`,
      sql`DELETE FROM knowledge.check_start`,
      sql`INSERT INTO knowledge.check_start (route_id, version_number, started_at)
          VALUES ('qm-sample', 1, now() - interval '2 days')`,
    ]) {
      await expect(testDatabase.apiDb.execute(change)).rejects.toThrow();
    }
    for (const db of [testDatabase.authDb, testDatabase.auditDb, testDatabase.jobsDb]) {
      await expect(db.execute(sql`SELECT 1 FROM knowledge.check_start`)).rejects.toThrow();
    }
  });
});

describe('knowledge.check_progress (ADR-0027, on demand)', () => {
  const written = () => postgresCheckProgressStore(() => testDatabase.jobsDb);
  const read = () => postgresCheckProgressStore(() => testDatabase.apiDb);

  it('records events from app_jobs and reads them back in order on app_api', async () => {
    const startId = randomUUID();
    await written().record(startId, 1, { kind: 'page', url: law, outcome: 'reading' });
    await written().record(startId, 0, { kind: 'started', items: 3, pages: 1 });
    await written().record(startId, 2, { kind: 'page', url: law, outcome: 'http_status' });
    await written().record(startId, 3, { kind: 'locating', pages: 1 });
    await written().record(startId, 4, { kind: 'comparing' });
    await written().record(startId, 5, { kind: 'failed', code: 'check_failed' });
    await written().record(randomUUID(), 0, { kind: 'finished' });
    expect(await read().list(startId)).toEqual([
      { kind: 'started', items: 3, pages: 1 },
      { kind: 'page', url: law, outcome: 'reading' },
      { kind: 'page', url: law, outcome: 'http_status' },
      { kind: 'locating', pages: 1 },
      { kind: 'comparing' },
      { kind: 'failed', code: 'check_failed' },
    ]);
  });

  it('keeps one event per sequence number of a start', async () => {
    const startId = randomUUID();
    await written().record(startId, 0, { kind: 'comparing' });
    await expect(written().record(startId, 0, { kind: 'finished' })).rejects.toThrow();
  });

  it('never answers a row the closed event schema refuses', async () => {
    const startId = randomUUID();
    await written().record(startId, 0, { kind: 'comparing' });
    for (const [sequence, kind, detail] of [
      [1, 'thinking', '{}'],
      [2, 'page', '{"url":"https://www.gov.example/law","outcome":"read","text":"page words"}'],
      [3, 'failed', '{"code":"whatever the model said"}'],
    ] as const) {
      await testDatabase.jobsDb.execute(sql`
        INSERT INTO knowledge.check_progress (start_id, sequence, kind, detail)
        VALUES (${startId}, ${sequence}, ${kind}, ${detail}::jsonb)`);
    }
    expect(await read().list(startId)).toEqual([{ kind: 'comparing' }]);
  });

  it.each<[string, ReturnType<typeof sql>]>([
    ['a kind that is no code', sql`(${randomUUID()}, 0, 'Page Read!', '{}'::jsonb)`],
    ['a sequence number past the bound', sql`(${randomUUID()}, 1000, 'page', '{}'::jsonb)`],
    ['a detail that is no object', sql`(${randomUUID()}, 0, 'page', '[]'::jsonb)`],
    [
      'a detail large enough to hold page text',
      sql`(${randomUUID()}, 0, 'page', ${JSON.stringify({ url: 'x'.repeat(3_000) })}::jsonb)`,
    ],
  ])('refuses %s', async (_, values) => {
    await expect(
      testDatabase.jobsDb.execute(
        sql`INSERT INTO knowledge.check_progress (start_id, sequence, kind, detail) VALUES ${values}`,
      ),
    ).rejects.toThrow();
  });

  it('lets app_jobs only insert, app_api only read, and nobody change or backdate an event', async () => {
    const startId = randomUUID();
    await written().record(startId, 0, { kind: 'comparing' });
    for (const db of [testDatabase.apiDb, testDatabase.jobsDb, testDatabase.authDb]) {
      for (const change of [
        sql`UPDATE knowledge.check_progress SET kind = 'finished'`,
        sql`DELETE FROM knowledge.check_progress`,
        sql`INSERT INTO knowledge.check_progress (start_id, sequence, kind, detail, recorded_at)
            VALUES (${randomUUID()}, 0, 'comparing', '{}'::jsonb, now() - interval '1 day')`,
      ]) {
        await expect(db.execute(change)).rejects.toThrow();
      }
    }
    await expect(read().record(startId, 1, { kind: 'finished' })).rejects.toThrow();
    for (const db of [testDatabase.jobsDb, testDatabase.authDb, testDatabase.auditDb]) {
      await expect(db.execute(sql`SELECT 1 FROM knowledge.check_progress`)).rejects.toThrow();
    }
  });
});

describe('knowledge.independent_check (ADR-0027)', () => {
  it('stores a report from app_jobs and reads it back on app_api', async () => {
    const stored = report();
    await postgresCheckReportStore(() => testDatabase.jobsDb).save(stored);
    const store = postgresCheckReportStore(() => testDatabase.apiDb);
    const found = await store.find(stored.startId);
    expect(found).toEqual({ ...stored, checkedAt: expect.any(Number) as unknown });
    expect((await store.list()).find(({ startId }) => startId === stored.startId)).toEqual({
      startId: stored.startId,
      routeId: 'qm-sample',
      number: 1,
      ...key,
      checkedAt: found?.checkedAt,
      failed: false,
      clean: true,
    });
  });

  it('reads a report stored before items had several quotes as one with its single quote', async () => {
    const { quotes, ...rest } = matches;
    const single = { ...rest, quote: quotes[0]?.quote ?? null, url: law };
    const unchecked = {
      ...rest,
      status: 'could_not_check',
      quote: null,
      url: null,
      reason: 'page_cut',
    };
    const stored = report({ items: [single, unchecked] as never, clean: false });
    await postgresCheckReportStore(() => testDatabase.jobsDb).save(stored);
    const found = await postgresCheckReportStore(() => testDatabase.apiDb).find(stored.startId);
    expect(found?.items).toEqual([
      matches,
      { ...rest, status: 'could_not_check', quotes: [], reason: 'page_cut' },
    ]);
  });

  it('reads a fetch log stored before machine-readable addresses as pages read themselves', async () => {
    const [entry] = report().fetchLog;
    if (entry === undefined) throw new Error('the report has a fetch log');
    // The stored JSON leaves an undefined field out, as rows written before it had none.
    const stored = report({ fetchLog: [{ ...entry, machineReadableUrl: undefined }] as never });
    await postgresCheckReportStore(() => testDatabase.jobsDb).save(stored);
    const found = await postgresCheckReportStore(() => testDatabase.apiDb).find(stored.startId);
    expect(found?.fetchLog).toEqual([{ ...entry, machineReadableUrl: null }]);
  });

  it('keeps one report per start', async () => {
    const stored = report();
    const store = postgresCheckReportStore(() => testDatabase.jobsDb);
    await store.save(stored);
    await expect(store.save({ ...stored, model: 'claude-other' })).rejects.toThrow();
  });

  it.each<[string, Partial<NewCheckReport>]>([
    [
      'a clean flag on an item that does not match',
      {
        items: [{ ...matches, status: 'could_not_check', quotes: [], reason: 'page_cut' }],
      },
    ],
    ['a clean flag on no items', { items: [] }],
    ['a clean flag on a scripted report', { model: 'fake' }],
    ['no clean flag on a report where every item matches', { clean: false }],
    ['a malformed content hash', { contentHash: 'not-a-hash' }],
    ['a malformed guide hash', { guideHash: 'guide' }],
    ['a malformed failure code', { failure: 'Boom!' as never, failed: true, clean: true }],
  ])('refuses %s', async (_, patch) => {
    await expect(
      postgresCheckReportStore(() => testDatabase.jobsDb).save(report(patch)),
    ).rejects.toThrow();
  });

  it('never answers a row whose items the report schema refuses', async () => {
    const odd = report({ items: [{ ...matches, quotes: [{ quote: 'x'.repeat(801), url: law }] }] });
    await postgresCheckReportStore(() => testDatabase.jobsDb).save(odd);
    expect(
      await postgresCheckReportStore(() => testDatabase.apiDb).find(odd.startId),
    ).toBeUndefined();
  });

  it('lets app_jobs insert and read, app_api and app_auth only read, and nobody change a report', async () => {
    await postgresCheckReportStore(() => testDatabase.jobsDb).save(report());
    for (const db of [testDatabase.apiDb, testDatabase.authDb, testDatabase.jobsDb]) {
      for (const change of [
        sql`UPDATE knowledge.independent_check SET clean = false`,
        sql`DELETE FROM knowledge.independent_check`,
      ]) {
        await expect(db.execute(change)).rejects.toThrow();
      }
      await expect(
        db.execute(sql`SELECT count(*)::int AS n FROM knowledge.independent_check`),
      ).resolves.toBeDefined();
    }
    for (const db of [testDatabase.apiDb, testDatabase.authDb]) {
      await expect(postgresCheckReportStore(() => db).save(report())).rejects.toThrow();
    }
    await expect(
      testDatabase.auditDb.execute(sql`SELECT 1 FROM knowledge.independent_check`),
    ).rejects.toThrow();
  });
});
