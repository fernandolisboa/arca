import { createHash } from 'node:crypto';
import {
  type CatalogEntry,
  type CheckAnswer,
  type CheckItem,
  type ModelUsage,
  type ReadPage,
  type RouteVersion,
  type StageResult,
  type UpdateFailure,
  type UpdateStage,
  type ValidatorVerdict,
  addressPages,
  asDataText,
  checkItems,
  itemOutcome,
  machineReadableUrls,
  nextUpdateStep,
  pageLanguages,
  validatorVerdict,
  verifyAnswers,
} from '@arca/domain';
import {
  type Json,
  type RuleRowReading,
  type RuleRows,
  canonicalize,
  checkProposal,
  verifiedRouteVersion,
} from '@arca/knowledge';
import type { Logger } from '@arca/telemetry';
import { type ModelReply, loggedModelCall } from '../../ai/model-call.js';
import { addressesAsRead } from '../check/answer-text.js';
import { type FetchOutcome, type SourceFetcher, textDigest } from '../check/fetcher.js';
import { fetchPages } from '../check/read-pages.js';
import {
  type ResearchReply,
  type ResearchRequest,
  type RuleResearcher,
  type RuleValidator,
  type StageModel,
  type ValidationItem,
  researchReplySchema,
} from './ports.js';
import {
  type EndedProposal,
  type NewStage,
  type StoredStage,
  type UpdateItem,
  type UpdateStore,
  type ValidationOutput,
  researchOutputSchema,
  validationOutputSchema,
} from './store.js';

export interface RuleUpdateSettings {
  readonly store: UpdateStore;
  /** The rule rows as stored, and how they are read (ADR-0031). */
  readonly rows: () => Promise<RuleRows>;
  readonly reading: RuleRowReading;
  readonly fetcher: SourceFetcher;
  readonly researcher: RuleResearcher;
  readonly validator: RuleValidator;
  /** The model and effort settings give a stage at call time. */
  readonly model: (stage: 'research' | 'validation' | 'correction') => Promise<StageModel>;
  /** Today in São Paulo, the date a read page's sources are verified on. */
  readonly today: () => string;
  readonly logger: Logger;
  /** Monotonic milliseconds, for latencies. */
  readonly now: () => number;
}

/** One step of an update request: runs its next stage, or ends it; answers whether more remain. */
export type RuleUpdateStep = (requestId: string) => Promise<boolean>;

const route = 'workflow:update-route';

/** The most official pages one validation reads. */
const maxPages = 60;

/** Pages read at once. */
const parallelReads = 6;

/** A problem line as stored: its path may echo keys the model chose, so it is cut. */
const maxProblemLength = 500;

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const usageOf = (reply: ModelReply): ModelUsage => ({
  model: reply.model,
  inputTokens: reply.inputTokens ?? null,
  outputTokens: reply.outputTokens ?? null,
  cacheReadTokens: reply.cacheReadTokens ?? null,
  cacheWriteTokens: reply.cacheWriteTokens ?? null,
});

const asResult = (stage: StoredStage): StageResult =>
  stage.failure === null
    ? {
        stage: stage.stage,
        failure: null,
        needsCorrection: stage.needsCorrection,
        proposalValid: stage.proposalValid,
      }
    : { stage: stage.stage, failure: stage.failure };

const failed = (
  stage: UpdateStage,
  failure: `${UpdateStage}_${string}` | UpdateFailure,
): NewStage => ({
  stage,
  failure: failure as UpdateFailure,
  needsCorrection: null,
  proposalValid: null,
  output: null,
  usage: null,
  webSearches: null,
});

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/** A value as the validator reads it. */
const valueText = ({ kind, value }: CheckItem['values'][number]) => `${kind} ${value}`;

/**
 * The update request's pipeline (ADR-0031), one stage per workflow step: the pure controller picks
 * the stage from the stored results, so a retried or repeated step never runs a stage twice and no
 * stored row buys a third round. Research and correction ask the researcher; each validation checks
 * the proposal in code (schema, pins, hash, cases), reads every cited official page with the
 * guarded fetcher, verifies each quote on its page, and asks the validator only about quotes code
 * verified and no stored answer covers. A model failure ends the request with a fixed code. Page
 * text, quotes and model output never reach a log line.
 */
export function createRuleUpdate({
  store,
  rows: rowsOf,
  reading,
  fetcher,
  researcher,
  validator,
  model,
  today,
  logger,
  now,
}: RuleUpdateSettings): RuleUpdateStep {
  const call = <Reply extends ModelReply>(ask: () => Promise<Reply>) =>
    loggedModelCall(ask, { route, logger, now }, (error) =>
      error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? Object.assign(new Error(error.code), { code: error.code })
        : Object.assign(new Error('failed'), { code: 'failed' }),
    );

  const research = async (
    stage: 'research' | 'correction',
    request: ResearchRequest,
  ): Promise<NewStage> => {
    let reply: ModelReply & { readonly webSearches?: number };
    try {
      reply = await call(async () => researcher.research(request, await model(stage)));
    } catch (error) {
      const code =
        error instanceof Error &&
        'code' in error &&
        (error.code === 'timeout' || error.code === 'unparsable')
          ? error.code
          : 'failed';
      return failed(stage, `${stage}_${code}`);
    }
    const parsed = researchReplySchema.safeParse(reply.reply);
    const usage = usageOf(reply);
    const webSearches = reply.webSearches ?? null;
    if (!parsed.success) {
      return { ...failed(stage, `${stage}_unparsable`), usage, webSearches };
    }
    return {
      stage,
      failure: null,
      needsCorrection: false,
      proposalValid: true,
      output: { proposal: parsed.data },
      usage,
      webSearches,
    };
  };

  /** Each cited official page read once, on the hosts of every item citing it. */
  const readPages = async (
    entry: CatalogEntry,
    items: readonly CheckItem[],
    hostsOf: (pins: CheckItem['officialDomains']) => readonly string[] | undefined,
  ) => {
    const hosts = new Map<string, string[]>();
    for (const item of items) {
      const allowed = hostsOf(item.officialDomains) ?? [];
      for (const url of item.urls) {
        const before = hosts.get(url);
        hosts.set(
          url,
          before === undefined ? [...allowed] : before.filter((h) => allowed.includes(h)),
        );
      }
    }
    const addresses = machineReadableUrls(entry);
    const pages = new Map<string, ReadPage>();
    const log: ValidationOutput['pages'] = [];
    const read = async ([url, allowed]: [string, string[]]) => {
      const address = addresses.get(url);
      const outcome: FetchOutcome =
        address === undefined
          ? await fetcher.fetch(url, allowed)
          : await fetchPages(fetcher, addressPages(address), allowed);
      return [url, outcome] as const;
    };
    const wanted = [...hosts].slice(0, maxPages);
    // A few pages at a time, so the stage stays well inside the function's duration limit.
    for (let start = 0; start < wanted.length; start += parallelReads) {
      const batch = await Promise.all(wanted.slice(start, start + parallelReads).map(read));
      for (const [url, outcome] of batch) {
        if (!outcome.ok) logger.info({ route, errorCode: `update_fetch_${outcome.failure}` });
        log.push({
          url,
          outcome: outcome.ok ? 'read' : outcome.failure,
          sha256: outcome.ok ? textDigest(outcome.text) : null,
        });
        if (outcome.ok) {
          pages.set(url, {
            url,
            text: asDataText(outcome.text),
            cut: outcome.cut,
            chain: outcome.chain,
            echoes: addressesAsRead(outcome.chain).map(asDataText),
          });
        }
      }
    }
    return { pages, log };
  };

  /**
   * The version with each source's `verifiedAt` set by code: today where its page was read, the
   * base's date where an unchanged source was not; a new source nobody read gets no date at all,
   * so the proposal is refused instead (domain rule 1).
   */
  const verifiedOn = (
    version: RouteVersion,
    base: RouteVersion,
    read: ReadonlySet<string>,
  ): { readonly content: Json; readonly unread: readonly string[] } => {
    const baseDates = new Map(base.sources.map(({ url, verifiedAt }) => [url, verifiedAt]));
    const unread = version.sources
      .map(({ url }) => url)
      .filter((url) => !read.has(url) && !baseDates.has(url));
    return {
      content: {
        ...version,
        sources: version.sources.map((source) => ({
          ...source,
          verifiedAt: read.has(source.url) ? today() : (baseDates.get(source.url) ?? today()),
        })),
      } as unknown as Json,
      unread,
    };
  };

  const validate = async (
    stage: 'validation' | 'final_validation',
    proposal: ResearchReply,
    base: RouteVersion,
  ): Promise<NewStage> => {
    const rows = await rowsOf();
    const content = parseJson(proposal.versionJson);
    const cases = parseJson(proposal.casesJson);
    const first = await checkProposal(rows, base, content, cases, reading);
    const invalid = (problems: readonly string[]): NewStage => ({
      stage,
      failure: null,
      needsCorrection: true,
      proposalValid: false,
      output: {
        problems: problems.map((line) => line.slice(0, maxProblemLength)),
        proposal: null,
        items: [],
        pages: [],
      },
      usage: null,
      webSearches: null,
    });
    if (!first.ok) return invalid(first.problems);
    const items = checkItems(first.entry);
    const { pages, log } = await readPages(first.entry, items, first.officialHosts);
    const dated = verifiedOn(first.entry.version, base, new Set(pages.keys()));
    if (dated.unread.length > 0) {
      return invalid(
        dated.unread.map(
          (url) => `/sources: ${url} could not be read, so it has no verification date`,
        ),
      );
    }
    const checked = await checkProposal(rows, base, dated.content, cases, reading);
    if (!checked.ok) return invalid(checked.problems);

    const answers: CheckAnswer[] = items.map(({ key }) => ({
      key,
      status: 'matches',
      quotes: proposal.quotes
        .filter((quote) => quote.key === key)
        .map(({ url, quote }) => ({ url, quote: asDataText(quote) })),
    }));
    const verified = verifyAnswers(
      items,
      answers,
      pages,
      pageLanguages(checked.entry.version.country),
    );
    const { model: validatorModel, effort } = await model('validation');
    const keyOf = (item: CheckItem, quotes: readonly { url: string; quote: string }[]) =>
      sha256(
        canonicalize({
          kind: item.kind,
          title: item.title,
          values: item.values.map(valueText),
          quotes: quotes.map(({ url, quote }) => ({
            quote,
            page: log.find((page) => page.url === url)?.sha256 ?? null,
          })),
          model: validatorModel,
          prompt: validator.promptVersion,
        }),
      );
    const asked = verified.flatMap((result, index) => {
      const item = items[index];
      return result.status === 'matches' && item !== undefined
        ? [{ item, result, cacheKey: keyOf(item, result.quotes) }]
        : [];
    });
    const stored = await store.verdicts(asked.map(({ cacheKey }) => cacheKey));
    const unknown = asked.filter(({ cacheKey }) => !stored.has(cacheKey));
    const verdicts = new Map<string, ValidatorVerdict>(
      asked.flatMap(({ item, cacheKey }) => {
        const verdict = stored.get(cacheKey);
        return verdict === undefined ? [] : [[item.key, verdict] as const];
      }),
    );
    let usage: ModelUsage | null = null;
    if (unknown.length > 0) {
      const questions: ValidationItem[] = unknown.map(({ item, result }, index) => ({
        id: `i${String(index)}`,
        title: item.title,
        values: item.values.map(valueText),
        quote: result.quotes.map(({ quote }) => quote).join('\n'),
      }));
      let reply;
      try {
        reply = await call(() => validator.validate(questions, { model: validatorModel, effort }));
      } catch {
        return failed(stage, `${stage}_failed`);
      }
      usage = usageOf(reply);
      const byId = new Map(reply.reply.map((answer) => [answer.id, answer]));
      const fresh = unknown.flatMap(({ item, cacheKey }, index) => {
        const answer = byId.get(`i${String(index)}`);
        if (answer === undefined) return [];
        const verdict = validatorVerdict(answer.choice, answer.confidence);
        verdicts.set(item.key, verdict);
        return [{ key: cacheKey, verdict }];
      });
      await store.remember(fresh);
    }

    const outcomes: UpdateItem[] = verified.map((result, index) => {
      const item = items[index];
      const outcome = itemOutcome(result, verdicts.get(result.key));
      return {
        key: result.key,
        kind: item?.kind ?? '',
        title: item?.title ?? '',
        list: outcome.list,
        reason: outcome.reason,
        quotes: result.quotes.map(({ url, quote }) => ({ url, quote })),
        urls: [...(item?.urls ?? [])],
      };
    });
    const output = validationOutputSchema.parse({
      problems: [],
      proposal: { content: dated, contentHash: checked.hash, cases: checked.cases },
      items: outcomes,
      pages: log,
    });
    return {
      stage,
      failure: null,
      needsCorrection: outcomes.some(({ list }) => list === 'divergent'),
      proposalValid: true,
      output,
      usage,
      webSearches: null,
    };
  };

  return async (requestId) => {
    const request = await store.request(requestId);
    if (request === undefined || (await store.end(requestId)) !== undefined) return false;
    const stages = await store.stages(requestId);
    const step = nextUpdateStep(stages.map(asResult));
    const rows = await rowsOf();
    const verified = verifiedRouteVersion(rows, request.routeId, request.baseNumber, reading);
    if (step.kind === 'failed') {
      await store.finish(requestId, { failure: step.failure });
      return false;
    }
    if (step.kind === 'finished') {
      const last = validationOutputSchema.safeParse(stages.at(-1)?.output);
      const proposal = last.success ? last.data.proposal : null;
      if (proposal === null) {
        await store.finish(requestId, { failure: 'proposal_invalid' });
        return false;
      }
      const ended: EndedProposal = { ...proposal, items: last.success ? last.data.items : [] };
      await store.finish(requestId, { proposal: ended });
      return false;
    }
    if (verified === undefined) {
      await store.finish(requestId, { failure: 'unknown_route' });
      return false;
    }
    const { row: baseRow, version: base, officialHosts } = verified;
    const position = stages.length;
    const latestProposal = () => {
      const output = [...stages]
        .reverse()
        .map((stage) => researchOutputSchema.safeParse(stage.output))
        .find((parsed) => parsed.success);
      return output?.data.proposal;
    };
    let result: NewStage;
    switch (step.stage) {
      case 'research':
      case 'correction': {
        const previous = latestProposal();
        const validation = validationOutputSchema.safeParse(stages.at(-1)?.output);
        // No official host means no domain limit on the web tools: research never runs then.
        if (officialHosts.length === 0) {
          result = failed(step.stage, `${step.stage}_failed`);
          break;
        }
        result = await research(step.stage, {
          routeId: request.routeId,
          current: baseRow.content,
          currentCases: baseRow.cases,
          officialHosts,
          ...(step.stage === 'correction' && previous !== undefined && validation.success
            ? {
                correction: {
                  proposal: previous,
                  problems: validation.data.problems,
                  items: validation.data.items
                    .filter(({ list }) => list === 'divergent')
                    .map(({ key, reason }) => ({ key, reason: reason ?? 'rejected' })),
                },
              }
            : {}),
        });
        break;
      }
      case 'validation':
      case 'final_validation': {
        const proposal = latestProposal();
        result =
          proposal === undefined
            ? failed(step.stage, 'out_of_order')
            : await validate(step.stage, proposal, base);
        break;
      }
    }
    await store.addStage(requestId, position, result);
    return true;
  };
}
