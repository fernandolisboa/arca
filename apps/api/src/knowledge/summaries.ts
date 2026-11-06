import { RuleSummary } from '@arca/api-contract/routes';
import type { VersionView } from '@arca/domain';
import type { Logger } from '@arca/telemetry';
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
  /** Monotonic milliseconds, for the model call's latency. */
  readonly now: () => number;
}

const route = '/v1/knowledge/versions/summary';

/** Model calls one summary may take: the first and one retry on an unparsable reply. */
export const summaryAttempts = 2;

/**
 * What the model reads: the version's content alone. Its state and what rejecting it would do to
 * today's selection change with decisions, so they stay out, and the content hash keys the cache.
 */
export function summaryContent(view: VersionView): string {
  return JSON.stringify({ ...view, hash: undefined, state: undefined, rejection: undefined });
}

/** The summary of `content`, asked for again once when the reply does not parse. */
export async function readRuleSummary(
  summarizer: Summarizer,
  content: string,
  onUnparsable: () => void = () => undefined,
): Promise<RuleSummary> {
  for (let attempt = 0; attempt < summaryAttempts; attempt += 1) {
    try {
      const { reply } = await summarizer.summarize(content);
      const parsed = RuleSummary.safeParse(reply);
      if (parsed.success) return parsed.data;
      onUnparsable();
    } catch (error) {
      if (!(error instanceof SummarizerError) || error.code !== 'summary_unparsable') throw error;
    }
  }
  throw new SummarizerError('summary_unparsable');
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
  const kept = new Map<string, Promise<RuleSummary>>();

  const logged: Summarizer = {
    async summarize(content) {
      const started = now();
      try {
        const reply = await summarizer.summarize(content);
        logger.info({
          route,
          model: reply.model,
          promptVersion: reply.promptVersion,
          ...(reply.inputTokens === undefined ? {} : { inputTokens: reply.inputTokens }),
          ...(reply.outputTokens === undefined ? {} : { outputTokens: reply.outputTokens }),
          durationMs: now() - started,
        });
        return reply;
      } catch (error) {
        const code = error instanceof SummarizerError ? error.code : 'summary_failed';
        logger.error({ route, errorCode: code, durationMs: now() - started });
        throw new SummarizerError(code);
      }
    },
  };
  const onUnparsable = () => {
    logger.error({ route, errorCode: 'summary_unparsable' });
  };

  return {
    async summarize(routeId, number) {
      const view = await versions.view(routeId, number);
      if (view === undefined) return { ok: false, reason: 'not_found' };
      let summary = kept.get(view.hash);
      if (summary === undefined) {
        summary = readRuleSummary(logged, summaryContent(view), onUnparsable);
        kept.set(view.hash, summary);
        const pending = summary;
        pending.catch(() => {
          if (kept.get(view.hash) === pending) kept.delete(view.hash);
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
