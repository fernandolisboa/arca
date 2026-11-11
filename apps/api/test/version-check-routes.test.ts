import { VersionCheck, type VersionView } from '@arca/api-contract/routes';
import { type CatalogEntry, routeVersionSchema, versionIdentity } from '@arca/domain';
import type { Logger } from '@arca/telemetry';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { SignedIn } from '../src/auth/service.js';
import { memoryCheckProgressStore } from '../src/knowledge/check/progress.js';
import type { CheckSubject } from '../src/knowledge/check/run.js';
import { memoryCheckStarts, type RecordedStart } from '../src/knowledge/check/starts.js';
import { type NewCheckReport, memoryCheckReportStore } from '../src/knowledge/check/store.js';
import { createVersionChecks } from '../src/knowledge/checks.js';
import type { KnowledgeDecisions } from '../src/knowledge/decisions.js';
import type { AdminGrants } from '../src/knowledge/admin-grants.js';
import type { KnowledgeVersions } from '../src/knowledge/versions.js';
import { noLimits } from './limits.js';

/** Synthetic routes only. */
const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const origin = 'http://arca.test';
const admin: SignedIn = {
  accountId: '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b',
  sessionId: '6a1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
};
const law = 'https://www.gov.example/law';
const hash = (number: number) => String(number % 10).repeat(64);

const versionFile = (number: number) =>
  routeVersionSchema.parse({
    schemaVersion: 1,
    routeId: 'qm-sample',
    number,
    title: 'Sample residence route',
    country: 'QM',
    tags: [],
    effectiveFrom: '2026-01-01',
    status: 'open',
    currency: 'EUR',
    sources: [
      { id: 'law', url: law, title: 'Residence act', kind: 'official', verifiedAt: '2026-10-01' },
    ],
    countries: { id: 'countries', number: 1 },
    formerCountries: { id: 'former-countries', number: 1 },
    countrySets: [],
    officialDomains: [{ id: 'qm-gov', number: 1 }],
    requirements: [
      {
        id: 'means',
        title: 'Means of subsistence',
        expression: { op: 'bool', value: true },
        sources: ['law'],
      },
    ],
    assessments: [],
    dependents: [],
    costs: [],
    durations: [],
  });

function setup({
  admitted = true,
  count = 3,
  states = new Map<number, 'proposed' | 'active' | 'rejected'>(),
  model = 'claude-test',
  enabled = true,
  unreadable = false,
  refusals = new Map(),
  runFails = false,
}: {
  /** Starting the workflow throws, as when the platform refuses it. */
  runFails?: boolean;
  admitted?: boolean;
  count?: number;
  states?: Map<number, 'proposed' | 'active' | 'rejected'>;
  model?: string;
  /** Whether the environment runs the check at all. */
  enabled?: boolean;
  /** Every stored report fails the report schema on the way out. */
  unreadable?: boolean;
  /** What the single decision answers for these version numbers, as when a race lost. */
  refusals?: Map<number, 'not_admin' | 'not_found' | 'already_rejected'>;
} = {}) {
  let time = 1_000_000_000;
  const now = () => time;
  const entries: CatalogEntry[] = Array.from({ length: count }, (_, index) => {
    const version = versionFile(index + 1);
    return { identity: versionIdentity(version, hash(index + 1)), version, countrySets: [] };
  });
  const versions: KnowledgeVersions = {
    list: () =>
      Promise.resolve(
        entries.map(({ identity, version }) => ({
          routeId: identity.routeId,
          number: identity.number,
          title: version.title,
          country: version.country,
          effectiveFrom: identity.effectiveFrom,
          hash: identity.hash,
          state: states.get(identity.number) ?? 'proposed',
        })),
      ),
    // Only the disabled check's read route asks; it needs to know the version exists.
    view: (_, number) => Promise.resolve(number <= count ? ({} as VersionView) : undefined),
    comparisons: () => Promise.resolve([]),
    comparisonView: () => Promise.resolve(undefined),
  };
  const subject = (routeId: string, number: number): CheckSubject | undefined => {
    const entry = entries.find(
      ({ identity }) => identity.routeId === routeId && identity.number === number,
    );
    return entry === undefined
      ? undefined
      : { entry, content: '{}', officialHosts: () => ['gov.example'] };
  };
  const reports = memoryCheckReportStore(now);
  const progress = memoryCheckProgressStore();
  const starts = memoryCheckStarts(reports, now, progress);
  const readReports = unreadable ? { ...reports, find: () => Promise.resolve(undefined) } : reports;
  const runs: RecordedStart[] = [];
  const checks = createVersionChecks({
    versions,
    subject,
    guide: () => undefined,
    checker: { model, promptVersion: 'check-1' },
    reports: readReports,
    starts,
    progress,
    run: (start) => {
      runs.push(start);
      return runFails ? Promise.reject(new Error('workflow down')) : Promise.resolve();
    },
    logger: silentLogger,
    now,
  });
  const admins: AdminGrants = {
    isAdmin: () => Promise.resolve(admitted),
    list: () => Promise.resolve([]),
    grant: () => Promise.resolve('changed'),
    remove: () => Promise.resolve('changed'),
  };
  const decided: unknown[][] = [];
  const knowledge: KnowledgeDecisions = {
    decide: (...args) => {
      decided.push(args);
      const { number } = args[2];
      return Promise.resolve(
        refusals.has(number)
          ? { refused: refusals.get(number) ?? 'not_found' }
          : { decided: `0d1e2f30-4152-4637-8a9b-0c1d2e3f4a5${String(number % 10)}` },
      );
    },
    states: () => Promise.resolve(new Map()),
  };
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: silentLogger,
    origin,
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve(admin),
      refresh: () => Promise.resolve({ session: null, setCookies: [] }),
    },
    authLimits: noLimits,
    admins,
    knowledge,
    knowledgeVersions: versions,
    ...(enabled ? { versionChecks: checks } : {}),
  });
  const start = (headers: Record<string, string> = { origin }) =>
    app.request('/v1/knowledge/checks/start', { method: 'POST', headers });
  const list = async () =>
    (
      (await (await app.request('/v1/knowledge/versions')).json()) as {
        versions: { number: number; check: string }[];
      }
    ).versions.map(({ number, check }) => [number, check]);
  const points = async () =>
    (
      (await (await app.request('/v1/knowledge/versions')).json()) as {
        versions: { number: number; points: unknown }[];
      }
    ).versions.map(({ number, points: counted }) => [number, counted]);
  const read = (number: number) =>
    app.request(`/v1/knowledge/versions/check?routeId=qm-sample&number=${String(number)}`);
  const report = (recorded: RecordedStart | undefined, patch: Partial<NewCheckReport> = {}) => {
    if (recorded === undefined) throw new Error('no start was recorded');
    return reports.save({
      startId: recorded.id,
      routeId: recorded.routeId,
      number: recorded.number,
      contentHash: hash(recorded.number),
      guideHash: 'none',
      promptVersion: 'check-1',
      model,
      items: [
        {
          key: 'requirement:means',
          status: 'matches',
          quotes: [{ quote: 'means of at least EUR 920', url: law }],
          note: null,
          reason: null,
        },
      ],
      fetchLog: [
        {
          url: law,
          machineReadableUrl: `${law}.json`,
          outcome: 'read',
          status: 200,
          durationMs: 5,
          sha256: null,
          cut: false,
        },
      ],
      failure: null,
      failed: false,
      clean: true,
      ...patch,
    });
  };
  const advance = (milliseconds: number) => {
    time += milliseconds;
  };
  const activateChecked = (body: unknown, headers: Record<string, string> = { origin }) =>
    app.request('/v1/knowledge/versions/activate-checked', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const startOne = (number: number, headers: Record<string, string> = { origin }) =>
    app.request('/v1/knowledge/versions/check/start', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ routeId: 'qm-sample', number }),
    });
  const watch = (number: number) =>
    app.request(`/v1/knowledge/versions/check/progress?routeId=qm-sample&number=${String(number)}`);
  const watched = async (number: number) =>
    ((await (await watch(number)).json()) as { progress: Record<string, unknown> | null }).progress;
  return {
    start,
    list,
    points,
    read,
    report,
    runs,
    starts,
    progress,
    advance,
    activateChecked,
    decided,
    startOne,
    watch,
    watched,
  };
}

const minute = 60_000;

describe('POST /v1/knowledge/checks/start (ADR-0027)', () => {
  it('starts a check of every proposed route version, with identifiers only', async () => {
    const { start, runs } = setup({ states: new Map([[2, 'active']]) });
    const response = await start();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ started: 2 });
    expect(runs.map(({ routeId, number }) => [routeId, number])).toEqual([
      ['qm-sample', 1],
      ['qm-sample', 3],
    ]);
  });

  it('starts nothing again while a check runs, and again once its start dies', async () => {
    const { start, advance } = setup();
    await start();
    expect(await (await start()).json()).toEqual({ started: 0 });
    advance(31 * minute);
    expect(await (await start()).json()).toEqual({ started: 3 });
  });

  it('starts nothing for a version with a current report', async () => {
    const { start, runs, report, advance } = setup({ count: 1 });
    await start();
    await report(runs[0]);
    advance(31 * minute);
    expect(await (await start()).json()).toEqual({ started: 0 });
  });

  it('stays within 15 starts in any 24 hours, so 5 are left for an admin', async () => {
    const { start, advance } = setup({ count: 25 });
    expect(await (await start()).json()).toEqual({ started: 15 });
    advance(31 * minute);
    expect(await (await start()).json()).toEqual({ started: 0 });
    advance(24 * 60 * minute);
    expect(await (await start()).json()).toEqual({ started: 15 });
  });

  it('is for admins only, from the same origin', async () => {
    expect((await setup({ admitted: false }).start()).status).toBe(403);
    const { start, runs } = setup();
    expect((await start({ origin: 'https://evil.example' })).status).toBe(403);
    expect((await start({ 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(runs).toEqual([]);
  });
});

describe('the check status in the version list (ADR-0027)', () => {
  it('reads running, checked, flagged, stale and none, and starts nothing', async () => {
    const { start, list, runs, report, advance } = setup({ count: 4 });
    expect(await list()).toEqual([
      [1, 'none'],
      [2, 'none'],
      [3, 'none'],
      [4, 'none'],
    ]);
    expect(runs).toEqual([]);
    await start();
    const [first, second, third] = runs as [RecordedStart, RecordedStart, RecordedStart];
    await report(first);
    await report(second, {
      clean: false,
      items: [
        {
          key: 'requirement:means',
          status: 'differs',
          quotes: [{ quote: 'means of at least EUR 920', url: law }],
          note: null,
          reason: null,
        },
      ],
    });
    await report(third, { model: 'claude-old' });
    expect(await list()).toEqual([
      [1, 'checked'],
      [2, 'flagged'],
      [3, 'stale'],
      [4, 'running'],
    ]);
    advance(31 * minute);
    expect(await list()).toEqual([
      [1, 'checked'],
      [2, 'flagged'],
      [3, 'stale'],
      [4, 'none'],
    ]);
  });

  it('carries the current report’s points, a scripted match counted as not confirmed', async () => {
    const { start, points, runs, report } = setup({ count: 2 });
    await start();
    await report(runs[0]);
    expect(await points()).toEqual([
      [1, { matches: 1, differs: 0, unread: 0 }],
      [2, null],
    ]);
    const scripted = setup({ count: 1, model: 'fake' });
    await scripted.start();
    await scripted.report(scripted.runs[0], { clean: false });
    expect(await scripted.points()).toEqual([[1, { matches: 0, differs: 0, unread: 1 }]]);
  });
});

describe('GET /v1/knowledge/versions/check (ADR-0027)', () => {
  it('answers the current report with each item named, as plain data', async () => {
    const { start, read, runs, report } = setup({ count: 1 });
    await start();
    await report(runs[0]);
    const response = await read(1);
    expect(response.status).toBe(200);
    const body = VersionCheck.parse(await response.json());
    expect(body).toEqual({
      enabled: true,
      status: 'checked',
      report: {
        checkedAt: new Date(1_000_000_000).toISOString(),
        clean: true,
        scripted: false,
        failure: null,
        guide: null,
        items: [
          {
            key: 'requirement:means',
            kind: 'requirement',
            title: 'Means of subsistence',
            status: 'matches',
            quotes: [{ quote: 'means of at least EUR 920', url: law }],
            note: null,
            reason: null,
          },
        ],
        fetchLog: [
          {
            url: law,
            machineReadableUrl: `${law}.json`,
            outcome: 'read',
            status: 200,
            cut: false,
          },
        ],
      },
    });
  });

  it('answers no report while a check runs or when only a stale one exists', async () => {
    const { start, read, runs, report, advance } = setup({ count: 1 });
    expect(await (await read(1)).json()).toEqual({ enabled: true, status: 'none', report: null });
    await start();
    expect(await (await read(1)).json()).toEqual({
      enabled: true,
      status: 'running',
      report: null,
    });
    await report(runs[0], { contentHash: 'f'.repeat(64) });
    advance(31 * minute);
    expect(await (await read(1)).json()).toEqual({ enabled: true, status: 'stale', report: null });
  });

  it('marks a scripted report as such, never clean', async () => {
    const { start, read, runs, report } = setup({ count: 1, model: 'fake' });
    await start();
    await report(runs[0], { clean: false });
    expect(await (await read(1)).json()).toMatchObject({
      status: 'flagged',
      report: { scripted: true, clean: false },
    });
  });

  it('never shows or counts as checked a report the report schema refuses', async () => {
    const { start, read, runs, report } = setup({ count: 1, unreadable: true });
    await start();
    await report(runs[0]);
    expect(await (await read(1)).json()).toEqual({ enabled: true, status: 'stale', report: null });
  });

  it('starts nothing and says the check is off where no checker is configured', async () => {
    const { start, read, list, runs } = setup({ count: 2, enabled: false });
    expect(await (await start()).json()).toEqual({ started: 0 });
    expect(runs).toEqual([]);
    expect(await list()).toEqual([
      [1, 'none'],
      [2, 'none'],
    ]);
    expect(await (await read(1)).json()).toEqual({ enabled: false, status: 'none', report: null });
    expect((await read(9)).status).toBe(404);
  });

  it('answers 404 for a version the catalog does not hold, and 403 to anyone but an admin', async () => {
    expect((await setup().read(9)).status).toBe(404);
    expect((await setup({ admitted: false }).read(1)).status).toBe(403);
  });
});

const shown = (number: number, versionHash = hash(number)) => ({
  routeId: 'qm-sample',
  number,
  hash: versionHash,
});
const flaggedItem = {
  key: 'requirement:means',
  status: 'differs',
  quotes: [{ quote: 'means of at least EUR 920', url: law }],
  note: null,
  reason: null,
} as const;

describe('POST /v1/knowledge/versions/activate-checked (ADR-0027)', () => {
  it('activates each checked version, one decision each, and skips the rest with a reason', async () => {
    const { start, runs, report, advance, activateChecked, decided } = setup({
      count: 6,
      states: new Map([[5, 'rejected']]),
    });
    await start();
    // The rejected version 5 is never started; version 6 gets no report.
    const [first, second, third, fourth] = runs;
    await report(first);
    await report(second, { clean: false, items: [flaggedItem] });
    // Stale: written for content that is no longer the bundled version's.
    await report(third, { contentHash: 'f'.repeat(64) });
    await report(fourth);
    advance(31 * minute);
    const response = await activateChecked({
      versions: [shown(1), shown(2), shown(3), shown(4, 'e'.repeat(64)), shown(5), shown(6)],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      activated: [
        { routeId: 'qm-sample', number: 1, decisionId: '0d1e2f30-4152-4637-8a9b-0c1d2e3f4a51' },
      ],
      skipped: [
        { routeId: 'qm-sample', number: 2, reason: 'flagged' },
        { routeId: 'qm-sample', number: 3, reason: 'not_checked' },
        { routeId: 'qm-sample', number: 4, reason: 'changed' },
        { routeId: 'qm-sample', number: 5, reason: 'rejected' },
        { routeId: 'qm-sample', number: 6, reason: 'not_checked' },
      ],
    });
    expect(decided).toEqual([
      [admin, 'activate', { subject: 'route', routeId: 'qm-sample', number: 1 }],
    ]);
  });

  it('skips a version an admin can no longer activate when its own decision refuses it', async () => {
    const { start, runs, report, activateChecked } = setup({
      count: 2,
      refusals: new Map([[2, 'already_rejected']]),
    });
    await start();
    for (const recorded of runs) await report(recorded);
    expect(await (await activateChecked({ versions: [shown(1), shown(2)] })).json()).toEqual({
      activated: [
        { routeId: 'qm-sample', number: 1, decisionId: '0d1e2f30-4152-4637-8a9b-0c1d2e3f4a51' },
      ],
      skipped: [{ routeId: 'qm-sample', number: 2, reason: 'rejected' }],
    });
  });

  it('activates nothing where no check runs', async () => {
    const { activateChecked, decided } = setup({ count: 1, enabled: false });
    expect(await (await activateChecked({ versions: [shown(1)] })).json()).toEqual({
      activated: [],
      skipped: [{ routeId: 'qm-sample', number: 1, reason: 'not_checked' }],
    });
    expect(decided).toEqual([]);
  });

  it('is for admins only, from the same origin, and refuses a body that repeats a version', async () => {
    const body = { versions: [shown(1)] };
    expect((await setup({ admitted: false }).activateChecked(body)).status).toBe(403);
    const { activateChecked, decided } = setup();
    expect((await activateChecked(body, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await activateChecked({ versions: [shown(1), shown(1)] })).status).toBe(400);
    expect((await activateChecked({ versions: [] })).status).toBe(400);
    expect(decided).toEqual([]);
  });
});

describe('POST /v1/knowledge/versions/check/start (ADR-0027, on demand)', () => {
  it.each(['proposed', 'active', 'rejected'] as const)(
    'starts a %s version, with identifiers only',
    async (state) => {
      const { startOne, runs } = setup({ states: new Map([[2, state]]) });
      const response = await startOne(2);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ started: true });
      expect(runs.map(({ routeId, number }) => [routeId, number])).toEqual([['qm-sample', 2]]);
    },
  );

  it('starts over a current report', async () => {
    const { start, startOne, runs, report } = setup({ count: 1 });
    await start();
    await report(runs[0]);
    expect(await (await startOne(1)).json()).toEqual({ started: true });
    expect(runs).toHaveLength(2);
  });

  it('answers the live start in place of a second one, and starts again once it reports or dies', async () => {
    const { startOne, runs, report, advance } = setup({ count: 1 });
    await startOne(1);
    expect(await (await startOne(1)).json()).toEqual({ started: false });
    expect(runs).toHaveLength(1);
    await report(runs[0]);
    expect(await (await startOne(1)).json()).toEqual({ started: true });
    advance(31 * minute);
    expect(await (await startOne(1)).json()).toEqual({ started: true });
    expect(runs).toHaveLength(3);
  });

  it('answers the live start an automatic start began', async () => {
    const { start, startOne, runs } = setup({ count: 1 });
    await start();
    expect(await (await startOne(1)).json()).toEqual({ started: false });
    expect(runs).toHaveLength(1);
  });

  it('uses the 5 starts the automatic share leaves, then answers the rate limit', async () => {
    const { start, startOne, runs, advance } = setup({ count: 25 });
    await start();
    advance(31 * minute);
    for (const number of [16, 17, 18, 19, 20]) {
      expect((await startOne(number)).status).toBe(200);
    }
    const limited = await startOne(21);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: { code: 'rate_limited' } });
    expect(runs).toHaveLength(20);
    advance(24 * 60 * minute);
    expect((await startOne(21)).status).toBe(200);
  });

  it('answers 404 for a version the app does not bundle', async () => {
    const { startOne, runs } = setup({ count: 1 });
    const response = await startOne(9);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'not_found' } });
    expect(runs).toEqual([]);
  });

  it('answers a fixed code where no checker is configured, after the version is known', async () => {
    const response = await setup({ enabled: false }).startOne(1);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'check_off' } });
    expect((await setup({ count: 1, enabled: false }).startOne(9)).status).toBe(404);
  });

  it('answers a fixed code when the run could not begin', async () => {
    const response = await setup({ runFails: true }).startOne(1);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: 'check_not_started' } });
  });

  it('is for admins only, from the same origin', async () => {
    const refused = await setup({ admitted: false }).startOne(1);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: { code: 'not_admin' } });
    const { startOne, runs } = setup();
    expect((await startOne(1, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await startOne(1, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(runs).toEqual([]);
  });
});

describe('GET /v1/knowledge/versions/check/progress (ADR-0027, on demand)', () => {
  it('answers null before any start, and starts nothing', async () => {
    const { watch, runs } = setup();
    const response = await watch(1);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ progress: null });
    expect(runs).toEqual([]);
  });

  it('shows a running check with the pages read so far', async () => {
    const { startOne, runs, progress, watched } = setup();
    await startOne(1);
    const id = runs[0]?.id ?? '';
    await progress.record(id, 0, { kind: 'started', items: 1, pages: 2 });
    await progress.record(id, 1, { kind: 'page', url: law, outcome: 'reading', status: null });
    await progress.record(id, 2, { kind: 'page', url: law, outcome: 'read', status: 200 });
    await progress.record(id, 3, {
      kind: 'page',
      url: `${law}/fees`,
      outcome: 'reading',
      status: null,
    });
    expect(await watched(1)).toEqual({
      startedAt: new Date(1_000_000_000).toISOString(),
      state: 'running',
      stage: 'reading',
      itemCount: 1,
      pageCount: 2,
      pages: [
        { url: law, outcome: 'read', status: 200 },
        { url: `${law}/fees`, outcome: 'reading', status: null },
      ],
      locatedPages: null,
      failure: null,
    });
  });

  it('shows a check finished once its report is stored, whatever progress says', async () => {
    const { startOne, runs, report, watched } = setup();
    await startOne(1);
    await report(runs[0]);
    expect(await watched(1)).toMatchObject({ state: 'finished', failure: null });
  });

  it('shows a failed check with its fixed code, and a new tap starts another', async () => {
    const { startOne, runs, progress, watched, list, advance } = setup({ count: 1 });
    await startOne(1);
    await progress.record(runs[0]?.id ?? '', 0, { kind: 'failed', code: 'check_failed' });
    expect(await watched(1)).toMatchObject({ state: 'failed', failure: 'check_failed' });
    expect(await list()).toEqual([[1, 'none']]);
    advance(minute);
    expect(await (await startOne(1)).json()).toEqual({ started: true });
    expect(runs).toHaveLength(2);
    expect(await watched(1)).toMatchObject({ state: 'running' });
  });

  it('shows a start dead after 30 minutes with no report, then nothing a day later', async () => {
    const { startOne, watched, advance } = setup();
    await startOne(1);
    advance(31 * minute);
    expect(await watched(1)).toMatchObject({ state: 'dead' });
    advance(24 * 60 * minute);
    expect(await watched(1)).toBeNull();
  });

  it('shows the newest start of the version only', async () => {
    const { startOne, runs, report, watched, advance } = setup();
    await startOne(1);
    await report(runs[0]);
    advance(minute);
    await startOne(1);
    await startOne(2);
    expect(await watched(1)).toMatchObject({
      state: 'running',
      startedAt: new Date(1_000_000_000 + minute).toISOString(),
    });
  });

  it('answers 404 for a version the app does not bundle, also where no check runs', async () => {
    expect((await setup({ count: 1 }).watch(9)).status).toBe(404);
    const off = setup({ count: 1, enabled: false });
    expect((await off.watch(9)).status).toBe(404);
    expect(await (await off.watch(1)).json()).toEqual({ progress: null });
  });

  it('is for admins only', async () => {
    const response = await setup({ admitted: false }).watch(1);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'not_admin' } });
  });
});
