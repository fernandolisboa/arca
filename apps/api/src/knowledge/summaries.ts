import { createHash } from 'node:crypto';
import { RuleSummary } from '@arca/api-contract/routes';
import type { VersionView } from '@arca/domain';
import type { Logger } from '@arca/telemetry';
import {
  type ModelCallLog,
  loggedModelCall,
  modelAttempts,
  parsedWithOneRetry,
} from '../ai/model-call.js';
import type { RuleSummaryStore, SummaryKey } from './summary/store.js';
import { type Summarizer, SummarizerError, type SummarizerFailure } from './summary/summarizer.js';
import { summaryContent } from './version-content.js';
import type { KnowledgeVersions } from './versions.js';

export type RuleSummaryOutcome =
  | { readonly ok: true; readonly value: RuleSummary }
  | { readonly ok: false; readonly reason: 'not_found' | SummarizerFailure };

export type StoredSummaryOutcome =
  | { readonly ok: true; readonly value: RuleSummary | null }
  | { readonly ok: false; readonly reason: 'not_found' };

/** A model's summary of one version for the approver (ADR-0025). */
export interface RuleSummaries {
  /** The summary already stored for the version, with no model call. */
  readonly stored: (routeId: string, number: number) => Promise<StoredSummaryOutcome>;
  /** The stored summary, or a new one from the model, which is then stored. */
  readonly summarize: (routeId: string, number: number) => Promise<RuleSummaryOutcome>;
}

export interface RuleSummarySettings {
  readonly versions: KnowledgeVersions;
  readonly summarizer: Summarizer;
  readonly store: RuleSummaryStore;
  /** What a stored summary is kept under besides the content: today's prompt and model. */
  readonly promptVersion: string;
  readonly model: string;
  readonly logger: Logger;
  readonly now: ModelCallLog['now'];
}

const route = '/v1/knowledge/versions/summary';

/** Model calls one summary may take: the first and one retry on an unparsable reply. */
export const summaryAttempts = modelAttempts;

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
 * What the model reads is summarized once per prompt and model: the summary is stored by that
 * content's digest, and a request for a summary still on its way in this instance waits for that
 * same call. A failure is not stored, so the next request asks again. Only bundled versions reach
 * the model, so the store holds one row per catalog version's content, prompt and model. The
 * content and the reply never reach a log line or an error.
 */
export function createRuleSummaries({
  versions,
  summarizer,
  store,
  promptVersion,
  model,
  logger,
  now,
}: RuleSummarySettings): RuleSummaries {
  const pending = new Map<string, Promise<RuleSummary>>();
  // Keyed by what the model reads, not the version's hash alone: its rule cases are read too and
  // can change under the same hash.
  const keyOf = (view: VersionView): SummaryKey => ({
    contentHash: createHash('sha256').update(summaryContent(view)).digest('hex'),
    promptVersion,
    model,
  });

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

  const summaryOf = async (view: VersionView): Promise<RuleSummary> => {
    const key = keyOf(view);
    const found = await store.find(key);
    if (found !== undefined) return found;
    const summary = await readRuleSummary(loggedSummarizer, summaryContent(view), onUnparsable);
    try {
      await store.save(key, summary);
    } catch {
      // The approver still gets the summary already paid for; the error, which may carry its
      // text, is dropped for a fixed code.
      logger.error({ route, errorCode: 'summary_not_stored' });
      return summary;
    }
    // Another instance may have stored its own first; every approver then reads that one.
    try {
      return (await store.find(key)) ?? summary;
    } catch {
      return summary;
    }
  };

  return {
    async stored(routeId, number) {
      const view = await versions.view(routeId, number);
      if (view === undefined) return { ok: false, reason: 'not_found' };
      return { ok: true, value: (await store.find(keyOf(view))) ?? null };
    },
    async summarize(routeId, number) {
      const view = await versions.view(routeId, number);
      if (view === undefined) return { ok: false, reason: 'not_found' };
      const { contentHash } = keyOf(view);
      let summary = pending.get(contentHash);
      if (summary === undefined) {
        summary = summaryOf(view);
        pending.set(contentHash, summary);
        const asked = summary;
        void asked.then(
          () => pending.delete(contentHash),
          () => pending.delete(contentHash),
        );
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
