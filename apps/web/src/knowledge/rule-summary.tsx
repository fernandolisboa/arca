import {
  type ApiError,
  type RuleSummary,
  routes,
  type VersionView,
} from '@arca/api-contract/client';
import { Button, Icon } from '@arca/ui';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api.js';
import { commonFailure, reach } from '../requests.js';

const summaryCodes = ['summary_unavailable', 'summary_timeout', 'summary_unparsable'] as const;
type SummaryCode = (typeof summaryCodes)[number];
const isSummaryCode = (code: string): code is SummaryCode =>
  (summaryCodes as readonly string[]).includes(code);

/**
 * The summary the server already stored, kept per content hash for the whole visit and outside the
 * `knowledge` keys a decision invalidates, so a decision never asks again.
 */
const storedSummaryQuery = ({ routeId, number, hash }: VersionView) =>
  queryOptions({
    queryKey: ['rule-summary', hash],
    queryFn: async () =>
      (await reach(api.call(routes.getVersionSummary, { routeId, number }))).summary,
    staleTime: Infinity,
    gcTime: Infinity,
    networkMode: 'always',
    retry: false,
  });

export interface RuleSummaryState {
  readonly summary: RuleSummary | undefined;
  /**
   * Whether the button belongs on screen: no summary is stored, or reading the stored one failed,
   * so asking again stays possible.
   */
  readonly canAsk: boolean;
  readonly asking: boolean;
  readonly failure: ReturnType<typeof commonFailure> | undefined;
  readonly ask: () => void;
}

/**
 * A model's summary of the version (ADR-0025): the stored one on arrival, a new one on request,
 * which the server stores, so it is still there after a reload.
 */
export function useRuleSummary(view: VersionView): RuleSummaryState {
  const queryClient = useQueryClient();
  const query = storedSummaryQuery(view);
  const stored = useQuery(query);
  const asked = useMutation({
    mutationFn: () =>
      reach(api.call(routes.summarizeVersion, { routeId: view.routeId, number: view.number })),
    networkMode: 'always',
    onSuccess: (summary) => queryClient.setQueryData(query.queryKey, summary),
  });
  return {
    summary: stored.data ?? undefined,
    canAsk: stored.data === null || stored.isError,
    asking: asked.isPending,
    failure: asked.isError
      ? commonFailure(asked.error, ({ code }: ApiError) => (isSummaryCode(code) ? code : undefined))
      : undefined,
    ask: () => {
      asked.mutate();
    },
  };
}

/** The button beside the version's title, until a summary exists. */
export function RuleSummaryButton({ state }: { readonly state: RuleSummaryState }) {
  const { t } = useTranslation();
  if (!state.canAsk) return null;
  return (
    <Button variant="secondary" disabled={state.asking} onClick={state.ask}>
      <Icon name="ai" size={18} />
      {state.failure === undefined ? t('knowledge.summary.button') : t('knowledge.summary.retry')}
    </Button>
  );
}

/**
 * The summary, or what is happening to the request. Plain text only, so nothing in the model's
 * reply becomes a link or an image; an aid to reading the rule, never a decision.
 */
export function RuleSummaryCard({ state }: { readonly state: RuleSummaryState }) {
  const { t } = useTranslation();
  const title = t('knowledge.summary.title');

  if (state.summary !== undefined) {
    const { overview, watchPoints } = state.summary;
    return (
      <section
        aria-label={title}
        className="flex flex-col gap-2 rounded-control border border-line bg-soft p-3"
      >
        <h4 className="flex items-center gap-2 font-medium">
          <Icon name="ai" size={18} />
          {title}
        </h4>
        <p>{overview}</p>
        <h5 className="font-medium">{t('knowledge.summary.watchPoints')}</h5>
        {watchPoints.length === 0 ? (
          <p className="text-muted">{t('knowledge.summary.noWatchPoints')}</p>
        ) : (
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {/* A point the model repeats shows once, so each text keys its own item. */}
            {[...new Set(watchPoints)].map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        )}
        <p className="text-small text-muted">{t('knowledge.summary.note')}</p>
      </section>
    );
  }

  // Only while there is something to say, so the decision keeps the screen's one status.
  if (!state.asking && state.failure === undefined) return null;
  return (
    <p role="status">
      {state.asking
        ? t('knowledge.summary.pending')
        : t('knowledge.summary.failure', { reason: state.failure })}
    </p>
  );
}
