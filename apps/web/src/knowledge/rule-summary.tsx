import { type ApiError, routes, type VersionView } from '@arca/api-contract/client';
import { Button } from '@arca/ui';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api.js';
import { commonFailure, reach } from '../requests.js';

const summaryCodes = ['summary_unavailable', 'summary_timeout', 'summary_unparsable'] as const;
type SummaryCode = (typeof summaryCodes)[number];
const isSummaryCode = (code: string): code is SummaryCode =>
  (summaryCodes as readonly string[]).includes(code);

/**
 * Kept per content hash for the whole visit, and outside the `knowledge` keys a decision
 * invalidates, so a decision never asks the model again.
 */
const summaryQuery = ({ routeId, number, hash }: VersionView) =>
  queryOptions({
    queryKey: ['rule-summary', hash],
    queryFn: () => reach(api.call(routes.summarizeVersion, { routeId, number })),
    staleTime: Infinity,
    gcTime: Infinity,
    networkMode: 'always',
    retry: false,
  });

/**
 * A model's summary of the version, on request (ADR-0025): an aid to reading it, never a decision.
 * Plain text only, so nothing in the model's reply becomes a link or an image.
 */
export function RuleSummary({ view }: { readonly view: VersionView }) {
  const { t } = useTranslation();
  const [asked, setAsked] = useState(false);
  const summary = useQuery({ ...summaryQuery(view), enabled: asked });
  const title = t('knowledge.summary.title');

  if (summary.data !== undefined) {
    const { overview, watchPoints } = summary.data;
    return (
      <section
        aria-label={title}
        className="flex flex-col gap-2 rounded-control border border-line bg-soft p-3"
      >
        <h4 className="font-medium">{title}</h4>
        <p>{overview}</p>
        <h5 className="font-medium">{t('knowledge.summary.watchPoints')}</h5>
        {watchPoints.length === 0 ? (
          <p className="text-muted">{t('knowledge.summary.noWatchPoints')}</p>
        ) : (
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {watchPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        )}
        <p className="text-small text-muted">{t('knowledge.summary.note')}</p>
      </section>
    );
  }

  const failure = summary.isError
    ? commonFailure(summary.error, ({ code }: ApiError) => (isSummaryCode(code) ? code : undefined))
    : undefined;
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        disabled={summary.isFetching}
        onClick={() => {
          if (asked) void summary.refetch();
          else setAsked(true);
        }}
      >
        {failure === undefined ? t('knowledge.summary.button') : t('knowledge.summary.retry')}
      </Button>
      {/* Only while there is something to say, so the decision keeps the screen's one status. */}
      {(summary.isFetching || failure !== undefined) && (
        <p role="status">
          {summary.isFetching
            ? t('knowledge.summary.pending')
            : t('knowledge.summary.failure', { reason: failure })}
        </p>
      )}
    </div>
  );
}
