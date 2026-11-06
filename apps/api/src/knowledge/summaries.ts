import { RuleSummary } from '@arca/api-contract/routes';
import type { VersionView } from '@arca/domain';
import type { Logger } from '@arca/telemetry';
import {
  type ModelCallLog,
  loggedModelCall,
  modelAttempts,
  parsedWithOneRetry,
} from '../ai/model-call.js';
import { type Summarizer, SummarizerError, type SummarizerFailure } from './summary/summarizer.js';
import type { KnowledgeVersions } from './versions.js';

export type RuleSummaryOutcome =
  | { readonly ok: true; readonly value: RuleSummary }
  | { readonly ok: false; readonly reason: 'not_found' | SummarizerFailure };

/** A model's summary of one version for the approver (ADR-0025). */
export interface RuleSummaries {
  readonly summarize: (routeId: string, number: number) => Promise<RuleSummaryOutcome>;
}

export interface RuleSummarySettings {
  readonly versions: KnowledgeVersions;
  readonly summarizer: Summarizer;
  readonly logger: Logger;
  readonly now: ModelCallLog['now'];
}

const route = '/v1/knowledge/versions/summary';

/** Model calls one summary may take: the first and one retry on an unparsable reply. */
export const summaryAttempts = modelAttempts;

/**
 * What the model reads: the version's content alone, field by field. Its hash, its state and what
 * rejecting it would do to today's selection stay out; a field added to the view stays out until
 * it is listed here.
 */
const summaryFields = [
  'routeId',
  'number',
  'title',
  'country',
  'tags',
  'effectiveFrom',
  'corrects',
  'status',
  'currency',
  'leapDayBirthday',
  'leapDayBirthdaySources',
  'referenceDates',
  'closureSources',
  'pins',
  'requirements',
  'assessments',
  'dependents',
  'costs',
  'durations',
  'countrySets',
  'sources',
  'replaces',
  'cases',
] as const satisfies readonly Exclude<keyof VersionView, 'hash' | 'state' | 'rejection'>[];

export function summaryContent(view: VersionView): string {
  return JSON.stringify(Object.fromEntries(summaryFields.map((field) => [field, view[field]])));
}

/** The summary of `content`, asked for again once when the reply does not parse. */
export function readRuleSummary(
  summarizer: Summarizer,
  content: string,
  onUnparsable: () => void = () => undefined,
): Promise<RuleSummary> {
  return parsedWithOneRetry(
    async () => (await summarizer.summarize(content)).reply,
    (reply) => {
      const parsed = RuleSummary.safeParse(reply);
      return parsed.success ? parsed.data : undefined;
    },
    {
      isUnparsable: (error) =>
        error instanceof SummarizerError && error.code === 'summary_unparsable',
      unparsable: () => new SummarizerError('summary_unparsable'),
      onUnparsable,
    },
  );
}

/**
 * Each version is summarized once per server instance: the summary is kept by content hash, and a
 * request for a summary still on its way waits for that same call. A failure is not kept, so the
 * next request asks again. Only bundled versions reach the model, so the cache holds at most one
 * entry per catalog version. The content and the reply never reach a log line or an error.
 */
export function createRuleSummaries({
  versions,
  summarizer,
  logger,
  now,
}: RuleSummarySettings): RuleSummaries {
  const cache = new Map<string, Promise<RuleSummary>>();

  const loggedSummarizer: Summarizer = {
    summarize: (content) =>
      loggedModelCall(
        () => summarizer.summarize(content),
        { route, logger, now },
        (error) =>
          error instanceof SummarizerError
            ? new SummarizerError(error.code)
            : new SummarizerError('summary_failed'),
      ),
  };
  const onUnparsable = () => {
    logger.error({ route, errorCode: 'summary_unparsable' });
  };

  return {
    async summarize(routeId, number) {
      const view = await versions.view(routeId, number);
      if (view === undefined) return { ok: false, reason: 'not_found' };
      let summary = cache.get(view.hash);
      if (summary === undefined) {
        summary = readRuleSummary(loggedSummarizer, summaryContent(view), onUnparsable);
        cache.set(view.hash, summary);
        const pending = summary;
        pending.catch(() => {
          if (cache.get(view.hash) === pending) cache.delete(view.hash);
        });
      }
      try {
        return { ok: true, value: await summary };
      } catch (error) {
        if (error instanceof SummarizerError) return { ok: false, reason: error.code };
        throw error;
      }
    },
  };
}
