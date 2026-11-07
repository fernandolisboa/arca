import { type CatalogEntry, routeVersionSchema, versionIdentity } from '@arca/domain';
import type { CountryGuideEntry } from '@arca/knowledge';
import type { Logger } from '@arca/telemetry';
import { describe, expect, it } from 'vitest';
import {
  type RuleCheckRequest,
  type RuleChecker,
  RuleCheckerError,
} from '../src/knowledge/check/checker.js';
import type { FetchOutcome, SourceFetcher } from '../src/knowledge/check/fetcher.js';
import { type CheckSubject, createVersionCheck } from '../src/knowledge/check/run.js';
import { scriptedCheckerChoice } from '../src/knowledge/check/scripted-checker.js';
import { memoryCheckReportStore } from '../src/knowledge/check/store.js';

/** Synthetic knowledge only: an invented route, hosts and amounts. */
const law = 'https://www.gov.example/law';
const fees = 'https://fees.gov.example/table';
const version = routeVersionSchema.parse({
  schemaVersion: 1,
  routeId: 'qm-sample',
  number: 1,
  title: 'Sample residence route',
  country: 'QM',
  tags: [],
  effectiveFrom: '2026-01-01',
  status: 'open',
  currency: 'EUR',
  sources: [
    { id: 'law', url: law, title: 'Residence act', kind: 'official', verifiedAt: '2026-10-01' },
    { id: 'fees', url: fees, title: 'Fee table', kind: 'official', verifiedAt: '2026-10-01' },
  ],
  countries: { id: 'countries', number: 1 },
  formerCountries: { id: 'former-countries', number: 1 },
  countrySets: [],
  officialDomains: [{ id: 'qm-gov', number: 1 }],
  requirements: [
    {
      id: 'means',
      title: 'Means of subsistence',
      expression: {
        op: 'gte',
        left: { op: 'fact', key: 'unit.liquidAssets' },
        right: { op: 'money', amount: 92000, currency: 'EUR' },
      },
      sources: ['law'],
    },
  ],
  assessments: [],
  dependents: [],
  costs: [
    {
      id: 'fee',
      title: 'Application fee',
      kind: 'fee',
      amount: { op: 'money', amount: 10000, currency: 'EUR' },
      appliesTo: 'principal',
      sources: ['fees'],
    },
  ],
  durations: [],
});
const entry: CatalogEntry = {
  identity: versionIdentity(version, 'c'.repeat(64)),
  version,
  countrySets: [],
};
const subject: CheckSubject = {
  entry,
  content: '{"title":"Sample residence route"}',
  officialHosts: (pins) => (pins.some(({ id }) => id === 'qm-gov') ? ['gov.example'] : undefined),
};
const lawText = 'Article 3. The applicant shows means of at least EUR 920 a month.';
const feeText = 'Application fee: EUR 100.';

const readAll: SourceFetcher = {
  fetch: (url) =>
    Promise.resolve<FetchOutcome>({
      ok: true,
      status: 200,
      text: url === law ? lawText : feeText,
      cut: false,
      chain: [url],
    }),
};

function answering(...replies: unknown[]): RuleChecker & { requests: RuleCheckRequest[] } {
  const requests: RuleCheckRequest[] = [];
  return {
    requests,
    check(request) {
      requests.push(request);
      const reply = replies.length > 1 ? replies.shift() : replies[0];
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve({ reply, model: 'claude-test', promptVersion: 'check-1' });
    },
  };
}

const matchesBoth = {
  items: [
    { key: 'requirement:means', status: 'matches', quote: 'means of at least EUR 920', url: law },
    { key: 'cost:fee', status: 'matches', quote: 'Application fee: EUR 100', url: fees },
  ],
};

function setup({
  checker = answering(matchesBoth),
  fetcher = readAll,
  guide,
  model = 'claude-test',
}: {
  checker?: RuleChecker;
  fetcher?: SourceFetcher;
  guide?: CountryGuideEntry;
  model?: string;
} = {}) {
  const store = memoryCheckReportStore(() => 1_000);
  const lines: unknown[] = [];
  const logger: Logger = {
    info: (line) => lines.push(line),
    error: (line) => lines.push(line),
  };
  const fetched: [string, readonly string[]][] = [];
  const check = createVersionCheck({
    subject: (routeId, number) => (routeId === 'qm-sample' && number === 1 ? subject : undefined),
    guide: () => guide,
    fetcher: {
      fetch: (url, hosts) => {
        fetched.push([url, hosts]);
        return fetcher.fetch(url, hosts);
      },
    },
    checker: { checker, model, promptVersion: 'check-1' },
    store,
    logger,
    now: () => 0,
  });
  return { check, store, lines, fetched };
}

const startId = '0b9c3d6e-1f2a-4b5c-8d7e-9f0a1b2c3d4e';

describe('the independent check of one version (ADR-0027)', () => {
  it('stores a clean report keyed by its start when every quote checks out', async () => {
    const { check, store, fetched } = setup();
    await check(startId, 'qm-sample', 1);
    expect(fetched).toEqual([
      [law, ['gov.example']],
      [fees, ['gov.example']],
    ]);
    expect(store.rows).toEqual([
      expect.objectContaining({
        startId,
        routeId: 'qm-sample',
        number: 1,
        contentHash: 'c'.repeat(64),
        guideHash: 'none',
        promptVersion: 'check-1',
        model: 'claude-test',
        failure: null,
        failed: false,
        clean: true,
      }),
    ]);
    expect(store.rows[0]?.items.map(({ status }) => status)).toEqual(['matches', 'matches']);
    expect(store.rows[0]?.fetchLog[0]).toEqual({
      url: law,
      outcome: 'read',
      status: 200,
      durationMs: 0,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      cut: false,
    });
  });

  it('sends the checker the version, its items, the pages read and the guide, no more', async () => {
    const checker = answering(matchesBoth);
    const guide = { hash: 'd'.repeat(64), guide: { id: 'qm' } } as unknown as CountryGuideEntry;
    const { check, store } = setup({ checker, guide });
    await check(startId, 'qm-sample', 1);
    expect(checker.requests).toEqual([
      {
        version: subject.content,
        items: [
          {
            key: 'requirement:means',
            kind: 'requirement',
            title: 'Means of subsistence',
            urls: [law],
          },
          { key: 'cost:fee', kind: 'cost', title: 'Application fee', urls: [fees] },
        ],
        pages: [
          { url: law, text: lawText },
          { url: fees, text: feeText },
        ],
        guide: '{"id":"qm"}',
      },
    ]);
    expect(store.rows[0]?.guideHash).toBe('d'.repeat(64));
  });

  it('flags a quote that is not on the page', async () => {
    const checker = answering({
      items: [
        { ...matchesBoth.items[0], quote: 'means of at least EUR 820 a month' },
        matchesBoth.items[1],
      ],
    });
    const { check, store } = setup({ checker });
    await check(startId, 'qm-sample', 1);
    expect(store.rows[0]?.clean).toBe(false);
    expect(store.rows[0]?.items[0]).toMatchObject({
      status: 'could_not_check',
      reason: 'quote_not_on_page',
    });
  });

  it('makes the items of a page not read could not be checked, and the report short-lived', async () => {
    const fetcher: SourceFetcher = {
      fetch: (url) =>
        url === fees
          ? Promise.resolve({ ok: false, failure: 'unsupported_type', status: 200, chain: [url] })
          : readAll.fetch(url, []),
    };
    const { check, store } = setup({ fetcher });
    await check(startId, 'qm-sample', 1);
    expect(store.rows[0]).toMatchObject({ failed: true, clean: false });
    expect(store.rows[0]?.items[1]).toMatchObject({ reason: 'page_not_read' });
    expect(store.rows[0]?.fetchLog[1]).toMatchObject({
      outcome: 'unsupported_type',
      sha256: null,
    });
  });

  it('refuses every page when the catalog lacks a pinned list', async () => {
    const lacking = setup();
    const check = createVersionCheck({
      subject: () => ({ ...subject, officialHosts: () => undefined }),
      guide: () => undefined,
      fetcher: {
        fetch: (url, hosts) => {
          lacking.fetched.push([url, hosts]);
          return readAll.fetch(url, hosts);
        },
      },
      checker: { checker: answering(matchesBoth), model: 'claude-test', promptVersion: 'check-1' },
      store: lacking.store,
      logger: { info: () => undefined, error: () => undefined },
      now: () => 0,
    });
    await check(startId, 'qm-sample', 1);
    expect(lacking.fetched.map(([, hosts]) => hosts)).toEqual([[], []]);
  });

  it.each<[string, unknown[], string, number]>([
    ['a timeout', [new RuleCheckerError('check_timeout')], 'check_timeout', 1],
    ['an unexpected error', [new TypeError('boom')], 'check_failed', 1],
    ['a reply that never parses', [{ verdict: 'fine' }], 'check_unparsable', 2],
  ])(
    'stores %s as a failed report with every item could not be checked',
    async (_, replies, failure, calls) => {
      const checker = answering(...replies);
      const { check, store, lines } = setup({ checker });
      await check(startId, 'qm-sample', 1);
      expect(checker.requests).toHaveLength(calls);
      expect(store.rows[0]).toMatchObject({ failure, failed: true, clean: false });
      expect(store.rows[0]?.items.every(({ status }) => status === 'could_not_check')).toBe(true);
      expect(JSON.stringify(lines)).not.toContain('boom');
    },
  );

  it('takes a reply that parses on the retry', async () => {
    const checker = answering({ verdict: 'fine' }, matchesBoth);
    const { check, store } = setup({ checker });
    await check(startId, 'qm-sample', 1);
    expect(checker.requests).toHaveLength(2);
    expect(store.rows[0]).toMatchObject({ failure: null, clean: true });
  });

  it('never stores a scripted report as clean', async () => {
    const { check, store } = setup({
      checker: scriptedCheckerChoice.checker,
      model: scriptedCheckerChoice.model,
    });
    await check(startId, 'qm-sample', 1);
    expect(store.rows[0]).toMatchObject({ model: 'fake', clean: false });
  });

  it('logs no page text and no model output', async () => {
    const { check, lines } = setup();
    await check(startId, 'qm-sample', 1);
    const logged = JSON.stringify(lines);
    expect(logged).not.toContain('920');
    expect(logged).not.toContain('Article');
  });

  it('stores nothing for a version the catalog does not hold', async () => {
    const { check, store, lines } = setup();
    await check(startId, 'qm-ghost', 1);
    expect(store.rows).toEqual([]);
    expect(lines).toEqual([expect.objectContaining({ errorCode: 'check_unknown_version' })]);
  });
});
