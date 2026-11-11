import {
  type CatalogEntry,
  excerptGap,
  maxPassagesPerItem,
  maxWholePageText,
  routeVersionSchema,
  versionIdentity,
} from '@arca/domain';
import type { CountryGuideEntry } from '@arca/knowledge';
import type { Logger } from '@arca/telemetry';
import { describe, expect, it } from 'vitest';
import {
  type RuleCheckRequest,
  type RuleChecker,
  RuleCheckerError,
} from '../src/knowledge/check/checker.js';
import {
  type FetchOutcome,
  type SourceFetcher,
  textDigest,
} from '../src/knowledge/check/fetcher.js';
import {
  type PassageLocateRequest,
  type PassageLocator,
  PassageLocatorError,
  scriptedLocator,
} from '../src/knowledge/check/locator.js';
import {
  type CheckProgressStore,
  memoryCheckProgressStore,
} from '../src/knowledge/check/progress.js';
import { type CheckSubject, createVersionCheck } from '../src/knowledge/check/run.js';
import { scriptedCheckerChoice } from '../src/knowledge/check/scripted-checker.js';
import { memoryCheckReportStore } from '../src/knowledge/check/store.js';
import { snapshotFetcher } from './eval/independent-check/harness.js';

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
    {
      key: 'requirement:means',
      status: 'matches',
      quotes: [{ quote: 'means of at least EUR 920', url: law }],
    },
    {
      key: 'cost:fee',
      status: 'matches',
      quotes: [{ quote: 'Application fee: EUR 100', url: fees }],
    },
  ],
};

/** Picks, for every item, the passage whose outline line holds each of `headings`, in order. */
function locating(...headings: string[]): PassageLocator & { requests: PassageLocateRequest[] } {
  const requests: PassageLocateRequest[] = [];
  return {
    requests,
    locate(request) {
      requests.push(request);
      const lines = request.outline.split('\n');
      const passages = headings.map((heading) => {
        const line = lines.find((entry) => entry.includes(heading)) ?? '';
        return Number(/^\[(\d+)\]/u.exec(line)?.[1]);
      });
      return Promise.resolve({
        reply: { items: request.items.map(({ key }) => ({ key, passages })) },
        model: 'locator-test',
        promptVersion: 'locate-1',
      });
    },
  };
}

function setup({
  checker = answering(matchesBoth),
  fetcher = readAll,
  locator = scriptedLocator,
  guide,
  model = 'claude-test',
  checked = subject,
  progress = memoryCheckProgressStore(),
  store = memoryCheckReportStore(() => 1_000),
}: {
  progress?: CheckProgressStore &
    Partial<Pick<ReturnType<typeof memoryCheckProgressStore>, 'rows'>>;
  store?: ReturnType<typeof memoryCheckReportStore>;
  checker?: RuleChecker;
  fetcher?: SourceFetcher;
  locator?: PassageLocator;
  guide?: CountryGuideEntry;
  model?: string;
  checked?: CheckSubject;
} = {}) {
  const lines: unknown[] = [];
  const logger: Logger = {
    info: (line) => lines.push(line),
    error: (line) => lines.push(line),
  };
  const fetched: [string, readonly string[]][] = [];
  const check = createVersionCheck({
    subject: (routeId, number) => (routeId === 'qm-sample' && number === 1 ? checked : undefined),
    guide: () => guide,
    fetcher: {
      fetch: (url, hosts) => {
        fetched.push([url, hosts]);
        return fetcher.fetch(url, hosts);
      },
    },
    checker: { checker, model, promptVersion: 'check-1' },
    locator,
    store,
    progress,
    logger,
    now: () => 0,
  });
  const events = () => (progress.rows ?? []).map(({ event }) => event);
  return { check, store, lines, fetched, events };
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
      machineReadableUrl: null,
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
          { url: law, text: lawText, excerpt: false },
          { url: fees, text: feeText, excerpt: false },
        ],
        guide: '{"id":"qm"}',
      },
    ]);
    expect(store.rows[0]?.guideHash).toBe('d'.repeat(64));
  });

  it('flags a quote that is not on the page', async () => {
    const checker = answering({
      items: [
        {
          ...matchesBoth.items[0],
          quotes: [{ quote: 'means of at least EUR 820 a month', url: law }],
        },
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

  describe('an item that joins provisions on two pages', () => {
    const joined = routeVersionSchema.parse({
      ...version,
      requirements: [
        {
          id: 'means',
          title: 'Means of subsistence, and the fee paid',
          expression: {
            op: 'all',
            operands: [
              ...version.requirements.map(({ expression }) => expression),
              {
                op: 'gte',
                left: { op: 'fact', key: 'principal.monthlyPassiveIncome' },
                right: { op: 'money', amount: 10000, currency: 'EUR' },
              },
            ],
          },
          sources: ['law', 'fees'],
        },
      ],
    });
    const joinedSubject: CheckSubject = {
      ...subject,
      entry: { ...entry, identity: versionIdentity(joined, 'c'.repeat(64)), version: joined },
    };
    // Only value coverage across pages is tested here: code cannot tell what a passage is about.
    const onLaw = { quote: 'means of at least EUR 920 a month', url: law };
    const onFees = { quote: 'Application fee: EUR 100', url: fees };
    const answeringMeans = (quotes: readonly { quote: string; url: string }[]) =>
      answering({
        items: [{ key: 'requirement:means', status: 'matches', quotes }, matchesBoth.items[1]],
      });

    it('stores a clean report with a quote from each page', async () => {
      const { check, store } = setup({
        checker: answeringMeans([onLaw, onFees]),
        checked: joinedSubject,
      });
      await check(startId, 'qm-sample', 1);
      expect(store.rows[0]?.items[0]).toEqual({
        key: 'requirement:means',
        status: 'matches',
        quotes: [onLaw, onFees],
        note: null,
        reason: null,
      });
      expect(store.rows[0]?.clean).toBe(true);
    });

    it.each([
      ['one quote, which leaves a value out', [onLaw], 'value_not_in_quote'],
      [
        'a second quote not on its page',
        [onLaw, { ...onFees, quote: 'Application fee: EUR 90' }],
        'quote_not_on_page',
      ],
      ['four quotes', [onLaw, onFees, onLaw, onFees], 'quote_count'],
    ] as const)('refuses the item on %s', async (_, quotes, reason) => {
      const { check, store } = setup({ checker: answeringMeans(quotes), checked: joinedSubject });
      await check(startId, 'qm-sample', 1);
      expect(store.rows[0]?.items[0]).toMatchObject({
        status: 'could_not_check',
        quotes: [],
        reason,
      });
      expect(store.rows[0]?.clean).toBe(false);
      // The other item still stands: one entry's quotes never fail the whole reply.
      expect(store.rows[0]?.failure).toBeNull();
      expect(store.rows[0]?.items[1]?.status).toBe('matches');
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
    expect(store.rows[0]?.items[1]).toMatchObject({ reason: 'no_page_read' });
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
      locator: scriptedLocator,
      store: lacking.store,
      progress: memoryCheckProgressStore(),
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

  describe('a page too long to send whole', () => {
    const filler = (number: number) =>
      `Article ${String(number)}. Other provisions\n${'Further provisions apply here. '.repeat(28)}`;
    const longLaw = [
      'Residence act, consolidated text',
      ...Array.from({ length: 200 }, (_, index) => filler(index + 1)),
      `Article 201. Means\n${lawText}`,
      ...Array.from({ length: 100 }, (_, index) => filler(index + 202)),
    ].join('\n');
    const fetcher: SourceFetcher = {
      fetch: (url) =>
        Promise.resolve<FetchOutcome>({
          ok: true,
          status: 200,
          text: url === law ? longLaw : feeText,
          cut: false,
          chain: [url],
        }),
    };

    it('sends the passages the locator picked, whole and verbatim, and counts a match on them', async () => {
      const checker = answering(matchesBoth);
      const locator = locating('Article 201. Means');
      const { check, store } = setup({ checker, fetcher, locator });
      await check(startId, 'qm-sample', 1);
      expect(longLaw.length).toBeGreaterThan(maxWholePageText);
      expect(locator.requests).toEqual([
        {
          items: [{ key: 'requirement:means', kind: 'requirement', title: 'Means of subsistence' }],
          sourceTitles: ['Residence act'],
          outline: expect.stringContaining('Article 201. Means') as unknown,
        },
      ]);
      const [sentLaw, sentFees] = checker.requests[0]?.pages ?? [];
      expect(sentLaw).toMatchObject({ url: law, excerpt: true });
      expect(sentLaw?.text.length).toBeLessThanOrEqual(maxWholePageText);
      expect(sentLaw?.text.startsWith('Residence act, consolidated text')).toBe(true);
      expect(sentLaw?.text).toContain(`Article 201. Means\n${lawText}`);
      for (const run of (sentLaw?.text ?? '').split(`\n${excerptGap}`)) {
        expect(longLaw).toContain(run.trim());
      }
      expect(sentFees).toEqual({ url: fees, text: feeText, excerpt: false });
      expect(store.rows[0]).toMatchObject({ failed: false, clean: true });
      expect(store.rows[0]?.fetchLog[0]).toMatchObject({
        cut: false,
        sha256: textDigest(sentLaw?.text ?? ''),
      });
    });

    it('asks the locator nothing about a page short enough to send whole', async () => {
      const locator = locating('Article');
      const { check } = setup({ locator });
      await check(startId, 'qm-sample', 1);
      expect(locator.requests).toEqual([]);
    });

    it.each<[string, PassageLocator]>([
      ['picks nothing', scriptedLocator],
      ['fails', { locate: () => Promise.reject(new PassageLocatorError('locate_timeout')) }],
      ['throws something else', { locate: () => Promise.reject(new TypeError('boom')) }],
      [
        'answers what does not parse',
        {
          locate: () =>
            Promise.resolve({ reply: { pick: 'all' }, model: 'm', promptVersion: 'locate-1' }),
        },
      ],
    ])(
      'sends the opening, cut, when the locator %s, so no match counts and the report is short-lived',
      async (_, locator) => {
        const checker = answering({
          items: [
            {
              ...matchesBoth.items[0],
              quotes: [{ quote: 'Residence act, consolidated text', url: law }],
            },
            matchesBoth.items[1],
          ],
        });
        const { check, store, lines } = setup({ checker, fetcher, locator });
        await check(startId, 'qm-sample', 1);
        const sentLaw = checker.requests[0]?.pages[0];
        // Told it is an excerpt, the model never reads the rest of the page as missing.
        expect(sentLaw).toMatchObject({ excerpt: true });
        const [opening, ...rest] = (sentLaw?.text ?? '').split(`\n${excerptGap}`);
        expect(rest).toEqual(['']);
        expect(longLaw.startsWith(opening ?? 'x')).toBe(true);
        expect(sentLaw?.text.length).toBe(maxWholePageText);
        expect(store.rows[0]).toMatchObject({ failed: true, clean: false, failure: null });
        expect(store.rows[0]?.fetchLog.map(({ cut }) => cut)).toEqual([true, false]);
        expect(store.rows[0]?.items[0]).toMatchObject({
          status: 'could_not_check',
          reason: 'page_cut',
        });
        expect(JSON.stringify(lines)).not.toContain('boom');
      },
    );

    it('keeps a quote across the gap of an excerpt from counting', async () => {
      const checker = answering({
        items: [
          {
            key: 'requirement:means',
            status: 'matches',
            quotes: [
              {
                url: law,
                // The end of the opening passage, the gap line, then the passage picked.
                quote: `Further provisions apply here. ${excerptGap} Article 201. Means ${lawText}`,
              },
            ],
          },
          matchesBoth.items[1],
        ],
      });
      const { check, store } = setup({ checker, fetcher, locator: locating('Article 201. Means') });
      await check(startId, 'qm-sample', 1);
      expect(checker.requests[0]?.pages[0]?.text).toContain(
        `Further provisions apply here. \n${excerptGap}\nArticle 201. Means\n${lawText}`,
      );
      expect(store.rows[0]?.items[0]).toMatchObject({
        status: 'could_not_check',
        reason: 'quote_not_on_page',
      });
    });

    it('keeps a page the fetcher cut marked cut, so no match counts on its excerpt', async () => {
      const cutFetcher: SourceFetcher = {
        fetch: async (url, hosts) => {
          const read = await fetcher.fetch(url, hosts);
          return read.ok && url === law ? { ...read, cut: true } : read;
        },
      };
      const { check, store } = setup({
        fetcher: cutFetcher,
        locator: locating('Article 201. Means'),
      });
      await check(startId, 'qm-sample', 1);
      expect(store.rows[0]?.fetchLog[0]).toMatchObject({ outcome: 'read', cut: true });
      expect(store.rows[0]?.items[0]).toMatchObject({ reason: 'page_cut' });
      expect(store.rows[0]).toMatchObject({ clean: false });
    });

    it('reads at most a few picks for an item, however many the locator names', async () => {
      const picked = Array.from({ length: maxPassagesPerItem + 2 }, (_, index) => index * 10 + 10);
      const checker = answering(matchesBoth);
      const locator = locating(
        ...picked.map((number) => `Article ${String(number)}. Other provisions`),
      );
      const { check } = setup({ checker, fetcher, locator });
      await check(startId, 'qm-sample', 1);
      const sent = checker.requests[0]?.pages[0]?.text ?? '';
      const read = picked.filter((number) => sent.includes(`Article ${String(number)}. Other`));
      expect(read).toEqual(picked.slice(0, maxPassagesPerItem));
    });

    it('has passages picked for a bounded number of long pages, each within its share', async () => {
      const urls = Array.from({ length: 12 }, (_, index) => `${law}/${String(index)}`);
      const many = routeVersionSchema.parse({
        ...version,
        sources: urls.map((url, index) => ({
          id: `law-${String(index)}`,
          url,
          title: 'Residence act',
          kind: 'official',
          verifiedAt: '2026-10-01',
        })),
        requirements: version.requirements.map((requirement) => ({
          ...requirement,
          sources: urls.map((_, index) => `law-${String(index)}`),
        })),
        costs: [],
      });
      const checked: CheckSubject = {
        ...subject,
        entry: { ...entry, version: many, identity: versionIdentity(many, 'c'.repeat(64)) },
      };
      const allLong: SourceFetcher = {
        fetch: (url) =>
          Promise.resolve({ ok: true, status: 200, text: longLaw, cut: false, chain: [url] }),
      };
      const checker = answering(matchesBoth);
      const locator = locating('Article 201. Means');
      const { check, store } = setup({ checker, fetcher: allLong, locator, checked });
      await check(startId, 'qm-sample', 1);
      expect(locator.requests).toHaveLength(10);
      const sent = checker.requests[0]?.pages ?? [];
      expect(sent).toHaveLength(12);
      for (const { text } of sent) expect(text.length).toBeLessThanOrEqual(200_000 / 12);
      expect(store.rows[0]?.fetchLog.filter(({ cut }) => cut)).toHaveLength(2);
      expect(store.rows[0]).toMatchObject({ failed: true });
    });

    it('sends the opening, cut, when the budget holds none of the picks', async () => {
      // Four pages sent whole leave the long one 1,400 characters: its opening and no more.
      const whole = [60_000, 60_000, 60_000, 18_600];
      const urls = [law, ...whole.map((_, index) => `${law}/${String(index)}`)];
      const many = routeVersionSchema.parse({
        ...version,
        sources: urls.map((url, index) => ({
          id: `law-${String(index)}`,
          url,
          title: 'Residence act',
          kind: 'official',
          verifiedAt: '2026-10-01',
        })),
        requirements: version.requirements.map((requirement) => ({
          ...requirement,
          sources: urls.map((_, index) => `law-${String(index)}`),
        })),
        costs: [],
      });
      const checked: CheckSubject = {
        ...subject,
        entry: { ...entry, version: many, identity: versionIdentity(many, 'c'.repeat(64)) },
      };
      const oneLong: SourceFetcher = {
        fetch: (url) =>
          Promise.resolve({
            ok: true,
            status: 200,
            text: url === law ? longLaw : 'x'.repeat(whole[urls.indexOf(url) - 1] ?? 0),
            cut: false,
            chain: [url],
          }),
      };
      const checker = answering(matchesBoth);
      const locator = locating('Article 201. Means');
      const { check, store } = setup({ checker, fetcher: oneLong, locator, checked });
      await check(startId, 'qm-sample', 1);
      expect(locator.requests).toHaveLength(1);
      const sent = checker.requests[0]?.pages.find(({ url }) => url === law);
      expect(sent?.text).toContain('Residence act, consolidated text');
      expect(sent?.text).not.toContain('Article 201');
      expect(store.rows[0]?.fetchLog.find(({ url }) => url === law)).toMatchObject({ cut: true });
      expect(store.rows[0]).toMatchObject({ failed: true });
    });

    it('ignores picks that are not passages of the page', async () => {
      const locator: PassageLocator = {
        locate: ({ items }) =>
          Promise.resolve({
            reply: { items: items.map(({ key }) => ({ key, passages: [999_999] })) },
            model: 'm',
            promptVersion: 'locate-1',
          }),
      };
      const checker = answering(matchesBoth);
      const { check, store } = setup({ checker, fetcher, locator });
      await check(startId, 'qm-sample', 1);
      expect(checker.requests[0]?.pages[0]?.text).not.toContain('Article 201');
      expect(store.rows[0]?.items[0]).toMatchObject({ reason: 'quote_not_on_page' });
      expect(store.rows[0]).toMatchObject({ failed: true });
      expect(store.rows[0]?.fetchLog[0]).toMatchObject({ cut: true });
    });
  });

  it('pays for no model call when no page was read', async () => {
    const checker = answering(matchesBoth);
    const fetcher: SourceFetcher = {
      fetch: (url) =>
        Promise.resolve({ ok: false, failure: 'network', status: null, chain: [url] }),
    };
    const { check, store } = setup({ checker, fetcher });
    await check(startId, 'qm-sample', 1);
    expect(checker.requests).toEqual([]);
    expect(store.rows[0]).toMatchObject({ failure: null, failed: true, clean: false });
    expect(store.rows[0]?.items.every(({ status }) => status === 'could_not_check')).toBe(true);
  });

  it('pays for no model call, and keeps the report short-lived, when every page read was empty', async () => {
    const checker = answering(matchesBoth);
    const fetcher: SourceFetcher = {
      fetch: (url) =>
        Promise.resolve({ ok: true, status: 200, text: '', cut: false, chain: [url] }),
    };
    const { check, store } = setup({ checker, fetcher });
    await check(startId, 'qm-sample', 1);
    expect(checker.requests).toEqual([]);
    expect(store.rows[0]).toMatchObject({ failure: null, failed: true, clean: false });
  });

  describe('a source that names a machine-readable address', () => {
    const data = 'https://api.gov.example/law';
    const lookalike = 'https://api.gov-example.example/law';
    const reading: CheckSubject = {
      ...subject,
      entry: {
        ...entry,
        version: routeVersionSchema.parse({
          ...version,
          sources: version.sources.map((source) =>
            source.url === law ? { ...source, machineReadableUrl: data } : source,
          ),
        }),
      },
    };
    const feePage = { body: `<p>${feeText}</p>` };
    const json = JSON.stringify({
      title: 'Residence act',
      number: 3,
      articles: [{ heading: 'Article 3', body: `<p>${lawText.slice(11)}</p>` }],
    });
    const xml = `<?xml version="1.0"?><!DOCTYPE act [<!ENTITY amount "EUR 1">]>
<act><title>Residence act</title><!-- &amount; --><section n="3">Article 3. The applicant shows means of at least <![CDATA[EUR 920]]> a month &amp; more.</section></act>`;
    const serving = (answer: { body: string; type: string; chain?: readonly string[] }) =>
      snapshotFetcher(
        new Map([
          [data, answer],
          [fees, feePage],
        ]),
      );

    it.each([
      [
        'a JSON answer as its strings in order, its markup read as a page',
        { body: json, type: 'application/json' },
        'Residence act\nArticle 3\nThe applicant shows means of at least EUR 920 a month.',
      ],
      [
        'an XML answer as its text in order, with no entity of its own expanded',
        { body: xml, type: 'application/xml' },
        'Residence act\nArticle 3. The applicant shows means of at least EUR 920 a month & more.',
      ],
    ])('reads %s in place of the page', async (_, answer, text) => {
      const checker = answering(matchesBoth);
      const { check, store, fetched } = setup({
        checker,
        checked: reading,
        fetcher: serving(answer),
      });
      await check(startId, 'qm-sample', 1);
      expect(fetched).toEqual([
        [data, ['gov.example']],
        [fees, ['gov.example']],
      ]);
      expect(checker.requests[0]?.pages[0]).toEqual({ url: law, text, excerpt: false });
      expect(store.rows[0]).toMatchObject({ failed: false, clean: true });
      expect(store.rows[0]?.items.map(({ status }) => status)).toEqual(['matches', 'matches']);
      expect(
        store.rows[0]?.fetchLog.map(({ url, machineReadableUrl }) => [url, machineReadableUrl]),
      ).toEqual([
        [law, data],
        [fees, null],
      ]);
    });

    it.each([
      [
        'character references in a JSON answer',
        (claim: string) => claim.replace(/./gsu, (char) => `&#${String(char.codePointAt(0))};`),
        (written: string) => ({
          body: JSON.stringify({ query: written }),
          type: 'application/json',
        }),
      ],
      [
        'tags in a JSON answer',
        (claim: string) => claim.replaceAll(' ', '<i></i> '),
        (written: string) => ({
          body: JSON.stringify({ query: written }),
          type: 'application/json',
        }),
      ],
      [
        'an encoded number sign before it in a JSON answer',
        (claim: string) => `#${claim}`,
        (written: string) => ({
          body: JSON.stringify({ query: written }),
          type: 'application/json',
        }),
      ],
      [
        'character references an XML answer escapes',
        (claim: string) => claim.replace(/./gsu, (char) => `&#${String(char.codePointAt(0))};`),
        (written: string) => ({
          body: `<search><query>${written.replaceAll('&', '&amp;')}</query></search>`,
          type: 'application/xml',
        }),
      ],
    ])(
      'takes no quote an address spells with %s for its answer to write back',
      async (_, spell, answer) => {
        const written = spell(lawText);
        const echoing = `https://api.gov.example/search?q=${encodeURIComponent(written)}`;
        const checked: CheckSubject = {
          ...subject,
          entry: {
            ...entry,
            version: routeVersionSchema.parse({
              ...version,
              sources: version.sources.map((source) =>
                source.url === law ? { ...source, machineReadableUrl: echoing } : source,
              ),
            }),
          },
        };
        const checker = answering(matchesBoth);
        const fetcher = snapshotFetcher(
          new Map([
            [echoing, answer(written)],
            [fees, feePage],
          ]),
        );
        const { check, store } = setup({ checker, checked, fetcher });
        await check(startId, 'qm-sample', 1);
        expect(checker.requests[0]?.pages[0]).toMatchObject({
          url: law,
          text: expect.stringContaining(lawText) as string,
        });
        expect(store.rows[0]?.items[0]).toMatchObject({
          status: 'could_not_check',
          reason: 'echoes_address',
        });
        expect(store.rows[0]?.clean).toBe(false);
      },
    );

    it.each<[string, SourceFetcher, string]>([
      [
        'redirects off the official hosts',
        serving({ body: json, type: 'application/json', chain: [data, lookalike] }),
        'redirect_refused',
      ],
      [
        'fails',
        {
          fetch: (url) =>
            url === data
              ? Promise.resolve({ ok: false, failure: 'http_status', status: 404, chain: [url] })
              : readAll.fetch(url, []),
        },
        'http_status',
      ],
    ])(
      'leaves its items could not be checked when the address %s, and never reads the page',
      async (_, fetcher, outcome) => {
        const { check, store, fetched } = setup({ checked: reading, fetcher });
        await check(startId, 'qm-sample', 1);
        expect(fetched.map(([url]) => url)).toEqual([data, fees]);
        expect(store.rows[0]).toMatchObject({ failed: true, clean: false });
        expect(store.rows[0]?.items[0]).toMatchObject({
          status: 'could_not_check',
          reason: 'no_page_read',
        });
        expect(store.rows[0]?.fetchLog[0]).toMatchObject({
          url: law,
          machineReadableUrl: data,
          outcome,
          sha256: null,
        });
      },
    );
  });

  it('stores nothing for a version the catalog does not hold', async () => {
    const { check, store, lines } = setup();
    await check(startId, 'qm-ghost', 1);
    expect(store.rows).toEqual([]);
    expect(lines).toEqual([expect.objectContaining({ errorCode: 'check_unknown_version' })]);
  });

  describe('its progress (ADR-0027, "On demand, with progress")', () => {
    it('records the start, each page before and after its read, the comparison and the end', async () => {
      const { check, events } = setup();
      await check(startId, 'qm-sample', 1);
      expect(events()).toEqual([
        { kind: 'started', items: 2, pages: 2 },
        { kind: 'page', url: law, outcome: 'reading' },
        { kind: 'page', url: law, outcome: 'read' },
        { kind: 'page', url: fees, outcome: 'reading' },
        { kind: 'page', url: fees, outcome: 'read' },
        { kind: 'comparing' },
        { kind: 'finished' },
      ]);
    });

    it('records why a page was not read, and no comparison when none was', async () => {
      const fetcher: SourceFetcher = {
        fetch: (url) =>
          Promise.resolve({ ok: false, failure: 'timeout', status: null, chain: [url] }),
      };
      const { check, events, store } = setup({ fetcher });
      await check(startId, 'qm-sample', 1);
      expect(events()).toEqual([
        { kind: 'started', items: 2, pages: 2 },
        { kind: 'page', url: law, outcome: 'reading' },
        { kind: 'page', url: law, outcome: 'timeout' },
        { kind: 'page', url: fees, outcome: 'reading' },
        { kind: 'page', url: fees, outcome: 'timeout' },
        { kind: 'finished' },
      ]);
      expect(store.rows).toHaveLength(1);
    });

    it('records how many long pages have passages picked', async () => {
      const long = 'Article 3. The applicant shows means of at least EUR 920 a month.\n\n'.repeat(
        Math.ceil(maxWholePageText / 60),
      );
      const fetcher: SourceFetcher = {
        fetch: (url) =>
          Promise.resolve({
            ok: true,
            status: 200,
            text: url === law ? long : feeText,
            cut: false,
            chain: [url],
          }),
      };
      const { check, events } = setup({ fetcher });
      await check(startId, 'qm-sample', 1);
      expect(events().map(({ kind }) => kind)).toEqual([
        'started',
        'page',
        'page',
        'page',
        'page',
        'locating',
        'comparing',
        'finished',
      ]);
      expect(events()).toContainEqual({ kind: 'locating', pages: 1 });
    });

    it('finishes when the model call fails, since the report says so', async () => {
      const { check, events, store } = setup({
        checker: answering(new RuleCheckerError('check_timeout')),
      });
      await check(startId, 'qm-sample', 1);
      expect(events().at(-1)).toEqual({ kind: 'finished' });
      expect(store.rows[0]).toMatchObject({ failure: 'check_timeout' });
    });

    it('never records page text or anything the model wrote', async () => {
      const { check, events } = setup({
        checker: answering({
          items: [
            {
              key: 'requirement:means',
              status: 'differs',
              quotes: [{ quote: 'means of at least EUR 920', url: law }],
              note: 'MODEL-NOTE-MARKER',
            },
          ],
        }),
      });
      await check(startId, 'qm-sample', 1);
      const recorded = JSON.stringify(events());
      expect(recorded).not.toContain('MODEL-NOTE-MARKER');
      expect(recorded).not.toContain('EUR 920');
      expect(recorded).not.toContain('Application fee');
    });

    it('records a failure and no report for a version the catalog does not hold', async () => {
      const { check, events, store } = setup();
      await check(startId, 'qm-ghost', 1);
      expect(events()).toEqual([{ kind: 'failed', code: 'check_unknown_version' }]);
      expect(store.rows).toEqual([]);
    });

    it('records a failure when the report cannot be stored, and still fails', async () => {
      const store = memoryCheckReportStore(() => 1_000);
      const { check, events } = setup({
        store: { ...store, save: () => Promise.reject(new Error('database down')) },
      });
      await expect(check(startId, 'qm-sample', 1)).rejects.toThrow('database down');
      expect(events().at(-1)).toEqual({ kind: 'failed', code: 'check_failed' });
    });

    it('carries on when progress cannot be written, logging a fixed code', async () => {
      const { check, store, lines } = setup({
        progress: {
          record: () => Promise.reject(new Error('progress SECRET-DETAIL')),
          list: () => Promise.resolve([]),
        },
      });
      await check(startId, 'qm-sample', 1);
      expect(store.rows[0]).toMatchObject({ clean: true, failed: false });
      expect(lines).toContainEqual(
        expect.objectContaining({ errorCode: 'check_progress_unwritten' }),
      );
      expect(JSON.stringify(lines)).not.toContain('SECRET-DETAIL');
    });
  });
});
