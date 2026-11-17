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
  asDataText,
  checkItems,
  firstListProblems,
  hostMatches,
  itemOutcome,
  machineReadableUrls,
  namedHosts,
  nextUpdateStep,
  officialDomainListSchema,
  pageLanguages,
  registryNamesHost,
  validatorVerdict,
  verifyAnswers,
} from '@arca/domain';
import {
  type Json,
  type PinnedFileRow,
  type ProposalTarget,
  type RuleRowReading,
  type RuleRows,
  canonicalize,
  checkProposal,
  maxProposalProblems,
  officialDomainListHash,
  verifiedOfficialDomainLists,
  verifiedRouteVersion,
} from '@arca/knowledge';
import type { Logger } from '@arca/telemetry';
import { type ModelReply, loggedModelCall } from '../../ai/model-call.js';
import { type SourceFetcher, textDigest } from '../check/fetcher.js';
import { readOfficialPage } from './official-page.js';
import {
  type NewRouteSubject,
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
  type ProposedList,
  type StoredRequest,
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

/** A pin as a new-route request stores it, `<id>/<number>`. */
const parsePin = (pin: string) => {
  const match = /^([a-z0-9][a-z0-9-]{0,63})\/([1-9][0-9]{0,6})$/.exec(pin);
  return match?.[1] === undefined || match[2] === undefined
    ? undefined
    : { id: match[1], number: Number(match[2]) };
};

/**
 * What a request researches and how its proposal is checked (ADR-0031): the stored route's newest
 * verified version, or a new route of a country on its approved lists, or, for a country with
 * none, on the hosts of the admin's links, proposing its first list.
 */
type RequestContext =
  | {
      readonly kind: 'update';
      readonly base: RouteVersion;
      readonly research: Omit<ResearchRequest, 'today' | 'correction'>;
    }
  | {
      readonly kind: 'new_route';
      readonly country: string;
      readonly pins: readonly { readonly id: string; readonly number: number }[];
      readonly research: Omit<ResearchRequest, 'today' | 'correction'> & {
        readonly newRoute: NewRouteSubject;
      };
      /** The hosts the admin named, for a new country; empty otherwise. */
      readonly namedHosts: readonly string[];
      /** The hosts of every imported list, where a first list's registry proof may also sit. */
      readonly approvedHosts: readonly string[];
    };

function requestContext(
  request: StoredRequest,
  rows: RuleRows,
  reading: RuleRowReading,
): RequestContext | undefined {
  if (request.kind === 'update') {
    const verified = verifiedRouteVersion(rows, request.routeId, request.baseNumber, reading);
    if (verified === undefined) return undefined;
    return {
      kind: 'update',
      base: verified.version,
      research: {
        routeId: request.routeId,
        current: verified.row.content,
        currentCases: verified.row.cases,
        officialHosts: verified.officialHosts,
      },
    };
  }
  const lists = verifiedOfficialDomainLists(rows, reading);
  const pins = request.listPins.map(parsePin);
  const pinned = pins.map((pin) =>
    pin === undefined
      ? undefined
      : lists.find(({ id, number }) => id === pin.id && number === pin.number),
  );
  // A pinned list that no longer reads leaves research with nothing it may trust.
  const known = pinned.flatMap((list) => (list === undefined ? [] : [list]));
  if (known.length !== request.listPins.length) return undefined;
  const linkHosts = request.links.flatMap((link) => {
    const host = reading.hostOf(link);
    return host === undefined ? [] : [{ link, host }];
  });
  const pinnedHosts = [...new Set(known.flatMap(({ hosts }) => hosts))];
  const newCountry = known.length === 0;
  const named = newCountry ? namedHosts(request.links, reading.hostOf) : [];
  const listId = request.country.toLowerCase();
  const firstList = newCountry
    ? {
        id: listId,
        number:
          Math.max(
            0,
            ...rows.officialDomainLists
              .filter(({ id }) => id === listId)
              .map(({ number }) => number),
          ) + 1,
      }
    : undefined;
  const officialHosts = newCountry ? named : pinnedHosts;
  return {
    kind: 'new_route',
    country: request.country,
    pins: known.map(({ id, number }) => ({ id, number })),
    namedHosts: named,
    approvedHosts: [
      ...new Set(lists.filter(({ fromRequest }) => !fromRequest).flatMap(({ hosts }) => hosts)),
    ],
    research: {
      routeId: null,
      current: null,
      currentCases: null,
      officialHosts,
      newRoute: {
        country: request.country,
        visa: request.visa,
        // Only addresses on the hosts research may read reach it (ADR-0031).
        links: linkHosts
          .filter(({ host }) => hostMatches(host, officialHosts))
          .map(({ link }) => link),
        listPins: known.map(({ id, number }) => ({ id, number })),
        ...(firstList === undefined ? {} : { firstList }),
      },
    },
  };
}

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
    const read = async ([url, allowed]: [string, string[]]) =>
      [url, await readOfficialPage(fetcher, url, addresses.get(url), allowed)] as const;
    const wanted = [...hosts].slice(0, maxPages);
    // A few pages at a time, so the stage stays well inside the function's duration limit.
    for (let start = 0; start < wanted.length; start += parallelReads) {
      const batch = await Promise.all(wanted.slice(start, start + parallelReads).map(read));
      for (const [url, { outcome, page }] of batch) {
        if (!outcome.ok) logger.info({ route, errorCode: `update_fetch_${outcome.failure}` });
        log.push({
          url,
          outcome: outcome.ok ? 'read' : outcome.failure,
          sha256: outcome.ok ? textDigest(outcome.text) : null,
        });
        if (page !== undefined) pages.set(url, page);
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
    base: RouteVersion | undefined,
    read: ReadonlySet<string>,
  ): { readonly content: Json; readonly unread: readonly string[] } => {
    const baseDates = new Map(base?.sources.map(({ url, verifiedAt }) => [url, verifiedAt]));
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

  /**
   * A new country's first official-domain list, checked in code (ADR-0031): its schema, the ID and
   * number the request gave, no registry suffix, each host's registry proof on a host the admin
   * named or on an imported list and never on the list itself, and each proof page, read with the
   * guarded fetcher on those hosts only, naming its host. Its sources are dated by code.
   */
  const checkFirstList = async (
    proposal: ResearchReply,
    context: Extract<RequestContext, { kind: 'new_route' }>,
    wanted: { readonly id: string; readonly number: number },
  ): Promise<{ readonly list: PinnedFileRow } | { readonly problems: readonly string[] }> => {
    const parsed = officialDomainListSchema.safeParse(parseJson(proposal.domainListJson));
    if (!parsed.success) {
      return {
        problems: parsed.error.issues.map(
          ({ path, message }) => `domainList/${path.join('/')}: ${message}`,
        ),
      };
    }
    const list = parsed.data;
    const problems: string[] = [];
    if (list.id !== wanted.id) problems.push(`domainList/id: ${wanted.id}`);
    if (list.number !== wanted.number) problems.push(`domainList/number: ${String(wanted.number)}`);
    problems.push(
      ...firstListProblems(list, {
        namedHosts: context.namedHosts,
        approvedHosts: context.approvedHosts,
        hostOf: reading.hostOf,
      }),
    );
    if (problems.length > 0) return { problems };
    const trusted = [...context.namedHosts, ...context.approvedHosts];
    const proofs = await Promise.all(
      list.hosts.map(async ({ host, source }) => {
        const { outcome } = await readOfficialPage(fetcher, source.url, undefined, trusted);
        if (!outcome.ok) logger.info({ route, errorCode: `update_fetch_${outcome.failure}` });
        return outcome.ok && registryNamesHost(outcome.text, host);
      }),
    );
    proofs.forEach((found, index) => {
      if (!found) {
        problems.push(
          `domainList/hosts/${String(index)}/source/url: A registry page code could read that names ${list.hosts[index]?.host ?? 'the host'}`,
        );
      }
    });
    if (problems.length > 0) return { problems };
    const content = {
      ...list,
      hosts: list.hosts.map((entry) => ({
        ...entry,
        source: { ...entry.source, verifiedAt: today() },
      })),
    } as unknown as Json;
    return {
      list: {
        id: list.id,
        number: list.number,
        content,
        contentHash: officialDomainListHash(content, reading),
      },
    };
  };

  const validate = async (
    stage: 'validation' | 'final_validation',
    proposal: ResearchReply,
    context: RequestContext,
  ): Promise<NewStage> => {
    const rows = await rowsOf();
    const content = parseJson(proposal.versionJson);
    const cases = parseJson(proposal.casesJson);
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
    let target: ProposalTarget;
    let domainList: ProposedList | undefined;
    if (context.kind === 'update') {
      target = { kind: 'update', base: context.base };
    } else {
      const { firstList } = context.research.newRoute;
      let list: PinnedFileRow | undefined;
      if (firstList !== undefined) {
        const checkedList = await checkFirstList(proposal, context, firstList);
        if ('problems' in checkedList) return invalid(checkedList.problems);
        list = checkedList.list;
        domainList = {
          content: list.content as ProposedList['content'],
          contentHash: list.contentHash,
        };
      }
      target = {
        kind: 'new',
        country: context.country,
        pins: context.pins,
        ...(list === undefined ? {} : { list }),
      };
    }
    const base = context.kind === 'update' ? context.base : undefined;
    const first = await checkProposal(rows, target, content, cases, reading);
    if (!first.ok) return invalid(first.problems);
    const items = checkItems(first.entry);
    const { pages, log } = await readPages(first.entry, items, first.officialHosts);
    const dated = verifiedOn(first.entry.version, base, new Set(pages.keys()));
    if (dated.unread.length > 0) {
      return invalid(
        dated.unread
          .slice(0, maxProposalProblems)
          .map((url) => `/sources: ${url} could not be read, so it has no verification date`),
      );
    }
    const checked = await checkProposal(rows, target, dated.content, cases, reading);
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
      proposal: {
        content: dated.content,
        contentHash: checked.hash,
        cases: checked.cases,
        ...(domainList === undefined ? {} : { domainList }),
      },
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
    const context = requestContext(request, rows, reading);
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
    if (context === undefined) {
      await store.finish(requestId, { failure: 'unknown_route' });
      return false;
    }
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
        if (context.research.officialHosts.length === 0) {
          result = failed(step.stage, `${step.stage}_failed`);
          break;
        }
        result = await research(step.stage, {
          ...context.research,
          today: today(),
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
            : await validate(step.stage, proposal, context);
        break;
      }
    }
    await store.addStage(requestId, position, result);
    return true;
  };
}
