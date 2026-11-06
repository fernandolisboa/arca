import { identityKey, parseCalendarDate } from '@arca/domain';
import type { LogEntry, Logger } from '@arca/telemetry';
import { describe, expect, it } from 'vitest';
import { createRuleSummaries, summaryContent } from '../src/knowledge/summaries.js';
import { memorySummaryStore, type RuleSummaryStore } from '../src/knowledge/summary/store.js';
import {
  type Summarizer,
  SummarizerError,
  type SummarizerReply,
} from '../src/knowledge/summary/summarizer.js';
import { createKnowledgeVersions } from '../src/knowledge/versions.js';

// The rule summary service against the bundled catalog and a fake summarizer (ADR-0025).
const catalog = await createKnowledgeVersions({
  states: () => Promise.resolve(new Map()),
  today: () => parseCalendarDate('2026-11-06'),
}).list();
const [firstListed, secondListed] = catalog;
if (firstListed === undefined || secondListed === undefined) {
  throw new Error('the catalog is too small');
}
const first = { identity: firstListed, version: { title: firstListed.title } };
const second = { identity: secondListed };
const firstKey = identityKey(firstListed);
const summary = { overview: 'Um resumo.', watchPoints: ['Confira o valor.'] };
const reply = (value: unknown): SummarizerReply => ({
  reply: value,
  model: 'claude-test',
  promptVersion: 'rule-summary-test',
  inputTokens: 1_000,
  outputTokens: 200,
});

function setup(
  answers: (() => Promise<SummarizerReply>)[] = [],
  { store = memorySummaryStore(), promptVersion = 'rule-summary-test', model = 'claude-test' } = {},
) {
  let state: 'active' | 'proposed' = 'proposed';
  const versions = createKnowledgeVersions({
    states: () => Promise.resolve(new Map([[firstKey, state]])),
    today: () => parseCalendarDate('2026-11-06'),
  });
  const sent: string[] = [];
  const summarizer: Summarizer = {
    summarize: (content) => {
      sent.push(content);
      return (answers.shift() ?? (() => Promise.resolve(reply(summary))))();
    },
  };
  const logs: LogEntry[] = [];
  const logger: Logger = { info: (entry) => logs.push(entry), error: (entry) => logs.push(entry) };
  const summaries = createRuleSummaries({
    versions,
    summarizer,
    store,
    promptVersion,
    model,
    logger,
    now: () => 0,
  });
  const activate = () => {
    state = 'active';
  };
  return { summaries, sent, logs, activate, versions, store };
}

describe('the rule summaries (ADR-0025)', () => {
  it('sends the content alone, never the state, the hash or the selection', async () => {
    const { summaries, sent, versions } = setup();
    const outcome = await summaries.summarize(first.identity.routeId, first.identity.number);
    expect(outcome).toEqual({ ok: true, value: summary });
    const [content] = sent;
    const view = await versions.view(first.identity.routeId, first.identity.number);
    if (view === undefined || content === undefined) throw new Error('no view');
    expect(content).toBe(summaryContent(view));
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed['title']).toBe(first.version.title);
    const withheld = ['hash', 'state', 'rejection'];
    // Every other field of the view is listed on purpose, so a new one fails here until it is.
    expect(Object.keys(parsed).sort()).toEqual(
      Object.keys(view)
        .filter((field) => !withheld.includes(field))
        .sort(),
    );
    expect(content).not.toContain(first.identity.hash);
  });

  it('summarizes each version once, whatever its state does meanwhile', async () => {
    const { summaries, sent, activate } = setup();
    const { routeId, number } = first.identity;
    const [one, two] = await Promise.all([
      summaries.summarize(routeId, number),
      summaries.summarize(routeId, number),
    ]);
    activate();
    const three = await summaries.summarize(routeId, number);
    expect([one, two, three]).toEqual(
      Array.from({ length: 3 }, () => ({ ok: true, value: summary })),
    );
    expect(sent).toHaveLength(1);
    await summaries.summarize(second.identity.routeId, second.identity.number);
    expect(sent).toHaveLength(2);
  });

  it('answers not_found for a version the catalog does not hold, with no call', async () => {
    const { summaries, sent } = setup();
    expect(await summaries.summarize(first.identity.routeId, 99_999)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(sent).toEqual([]);
  });

  it('asks again once when the reply does not parse, then gives up', async () => {
    const odd = () => Promise.resolve(reply({ overview: '', watchPoints: 'x' }));
    const retried = setup([odd]);
    expect(
      await retried.summaries.summarize(first.identity.routeId, first.identity.number),
    ).toEqual({
      ok: true,
      value: summary,
    });
    expect(retried.sent).toHaveLength(2);
    const failed = setup([odd, () => Promise.reject(new SummarizerError('summary_unparsable'))]);
    expect(await failed.summaries.summarize(first.identity.routeId, first.identity.number)).toEqual(
      {
        ok: false,
        reason: 'summary_unparsable',
      },
    );
    expect(failed.sent).toHaveLength(2);
  });

  it('keeps no failure, so the next request asks again', async () => {
    const { summaries, sent } = setup([
      () => Promise.reject(new SummarizerError('summary_timeout')),
    ]);
    const { routeId, number } = first.identity;
    expect(await summaries.summarize(routeId, number)).toEqual({
      ok: false,
      reason: 'summary_timeout',
    });
    expect(await summaries.summarize(routeId, number)).toEqual({ ok: true, value: summary });
    expect(sent).toHaveLength(2);
  });

  it('turns any other error into summary_failed and logs only metadata', async () => {
    const secret = 'conteudo-que-nao-pode-vazar';
    const { summaries, logs } = setup([() => Promise.reject(new RangeError(secret))]);
    const { routeId, number } = first.identity;
    expect(await summaries.summarize(routeId, number)).toEqual({
      ok: false,
      reason: 'summary_failed',
    });
    await summaries.summarize(routeId, number);
    expect(logs).toEqual([
      { route: '/v1/knowledge/versions/summary', errorCode: 'summary_failed', durationMs: 0 },
      {
        route: '/v1/knowledge/versions/summary',
        model: 'claude-test',
        promptVersion: 'rule-summary-test',
        inputTokens: 1_000,
        outputTokens: 200,
        durationMs: 0,
      },
    ]);
    expect(JSON.stringify(logs)).not.toContain(secret);
  });
  it('stores a summary, so a later service, as after a reload, answers it with no call', async () => {
    const { routeId, number } = first.identity;
    const { summaries, store } = setup();
    expect(await summaries.stored(routeId, number)).toEqual({ ok: true, value: null });
    await summaries.summarize(routeId, number);
    const later = setup([], { store });
    expect(await later.summaries.stored(routeId, number)).toEqual({ ok: true, value: summary });
    expect(await later.summaries.summarize(routeId, number)).toEqual({ ok: true, value: summary });
    expect(later.sent).toEqual([]);
  });

  it.each([
    ['prompt', { promptVersion: 'rule-summary-next' }],
    ['model', { model: 'claude-next' }],
  ])('asks again once the %s changes', async (_, changed) => {
    const { routeId, number } = first.identity;
    const store: RuleSummaryStore = memorySummaryStore();
    await setup([], { store }).summaries.summarize(routeId, number);
    const next = setup([], { store, ...changed });
    expect(await next.summaries.stored(routeId, number)).toEqual({ ok: true, value: null });
    await next.summaries.summarize(routeId, number);
    expect(next.sent).toHaveLength(1);
  });

  it('stores no failure', async () => {
    const { routeId, number } = first.identity;
    const { summaries } = setup([() => Promise.reject(new SummarizerError('summary_timeout'))]);
    await summaries.summarize(routeId, number);
    expect(await summaries.stored(routeId, number)).toEqual({ ok: true, value: null });
  });

  it('answers not_found for the stored summary of a version the catalog does not hold', async () => {
    const { summaries } = setup();
    expect(await summaries.stored(first.identity.routeId, 99_999)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});
