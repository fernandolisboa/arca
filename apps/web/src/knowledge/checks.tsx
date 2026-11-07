import {
  type KnowledgeVersion,
  routes,
  type VersionCheckReport,
  type VersionView,
} from '@arca/api-contract/client';
import { Button, Icon, StatusChip, type StatusTone } from '@arca/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef } from 'react';
import { api, versionCheckQuery } from '../api.js';
import { card, surface } from './review-parts.js';
import type { KnowledgeWords } from './words.js';

type ListedCheck = KnowledgeVersion['check'];
type ReportItem = VersionCheckReport['items'][number];

/**
 * Starts the checks that are due once per visit to the screen, after the list loaded (ADR-0027):
 * the server picks the versions and keeps the daily cap, so the screen sends no identities. A
 * failed start changes nothing on screen; the next visit asks again.
 */
export function useStartChecks(ready: boolean): void {
  const queryClient = useQueryClient();
  const sentRef = useRef(false);
  const { mutate } = useMutation({
    mutationFn: () => api.call(routes.startVersionChecks),
    networkMode: 'always',
    onSuccess: ({ started }) =>
      started > 0 ? queryClient.invalidateQueries({ queryKey: ['knowledge'] }) : undefined,
  });
  useEffect(() => {
    if (!ready || sentRef.current) return;
    sentRef.current = true;
    mutate();
  }, [ready, mutate]);
}

/** Only a clean current report reads as fine; anything short of it never looks passed. */
function listedTone(status: ListedCheck): StatusTone {
  if (status === 'checked') return 'ok';
  return status === 'flagged' ? 'warn' : 'unknown';
}

function itemTone(status: ReportItem['status']): StatusTone {
  if (status === 'matches') return 'ok';
  return status === 'differs' ? 'warn' : 'unknown';
}

/** A route version's check status on the list. */
export function CheckChip({
  status,
  words,
}: {
  readonly status: ListedCheck;
  readonly words: KnowledgeWords;
}) {
  return (
    <StatusChip
      tone={listedTone(status)}
      label={words.t('knowledge.check.listStatus', { status })}
    />
  );
}

/**
 * A route version's independent check: its current report, or why there is none. Written by a
 * model and checked in code; everything from the report is plain text, so no quote, note or URL
 * becomes a link or markup.
 */
export function CheckReport({
  view,
  words,
}: {
  readonly view: VersionView;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const titleId = useId();
  const check = useQuery(versionCheckQuery(view.routeId, view.number));
  return (
    <section aria-labelledby={titleId} className={card}>
      <h5 id={titleId} className="flex items-center gap-2 font-medium">
        <Icon name="ai" size={18} />
        {t('knowledge.check.title')}
      </h5>
      {check.isError ? (
        <div className="flex flex-col items-start gap-2">
          <p>{t('knowledge.check.loadFailure')}</p>
          <Button variant="secondary" onClick={() => void check.refetch()}>
            {t('knowledge.retry')}
          </Button>
        </div>
      ) : check.data === undefined ? null : check.data.report === null ? (
        <div role="status" className="flex flex-col gap-1">
          <p>{t('knowledge.check.status', { status: check.data.status })}</p>
          {view.state === 'proposed' && check.data.status !== 'running' && (
            <p className="text-small text-muted">{t('knowledge.check.startsOnOpen')}</p>
          )}
        </div>
      ) : (
        <ReportBody report={check.data.report} country={view.country} words={words} />
      )}
      <p className="text-small text-muted">{t('knowledge.check.footer')}</p>
    </section>
  );
}

function summaryOf({ items, clean }: VersionCheckReport, words: KnowledgeWords): string {
  const { t } = words;
  if (items.length === 0) return t('knowledge.check.noItems');
  if (clean) return t('knowledge.check.clean', { n: items.length });
  const matches = items.filter(({ status }) => status === 'matches').length;
  return t('knowledge.check.flagged', { matches, total: items.length });
}

function ReportBody({
  report,
  country,
  words,
}: {
  readonly report: VersionCheckReport;
  readonly country: string;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const problems = report.fetchLog.filter(({ outcome, cut }) => outcome !== 'read' || cut);
  const checkedAt = new Intl.DateTimeFormat(words.language, { dateStyle: 'long' }).format(
    new Date(report.checkedAt),
  );
  return (
    <>
      {report.scripted && <p className="font-medium">{t('knowledge.check.scripted')}</p>}
      {report.failure !== null && (
        <p className="font-medium">{t('knowledge.check.failure', { failure: report.failure })}</p>
      )}
      <p>{summaryOf(report, words)}</p>
      <p className="text-small text-muted">
        {t('knowledge.check.checkedAt', { date: checkedAt })} ·{' '}
        {report.guide === null
          ? t('knowledge.check.noGuide', { country: words.country(country) })
          : t('knowledge.check.guide', {
              country: words.country(report.guide.country),
              number: report.guide.number,
            })}
      </p>
      {report.items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {report.items.map((item) => (
            <li key={item.key}>
              <ReportItemCard item={item} words={words} />
            </li>
          ))}
        </ul>
      )}
      {problems.length > 0 && (
        <div className="flex flex-col gap-2">
          <h6 className="font-medium">{t('knowledge.check.pages')}</h6>
          <ul className="flex flex-col gap-2">
            {problems.map(({ url, outcome, status }) => (
              <li key={url} className="flex flex-col gap-1 text-small">
                <span>
                  {t('knowledge.check.outcome', { outcome, status: String(status ?? '') })}
                </span>
                <span className="font-mono break-all text-muted">{url}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function ReportItemCard({
  item,
  words,
}: {
  readonly item: ReportItem;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${surface}`}>
      <div className="flex flex-col gap-1">
        <span className="text-small text-muted">
          {t('knowledge.check.kind', { kind: item.kind })}
        </span>
        <span className="font-medium">{item.title}</span>
        <StatusChip
          tone={itemTone(item.status)}
          label={t('knowledge.check.itemStatus', { status: item.status })}
        />
      </div>
      {item.reason !== null && <p>{t('knowledge.check.reason', { reason: item.reason })}</p>}
      {item.quote !== null && (
        <figure className="flex flex-col gap-1">
          <figcaption className="text-small text-muted">{t('knowledge.check.quote')}</figcaption>
          <blockquote className="border-l-2 border-line pl-3 whitespace-pre-wrap">
            {item.quote}
          </blockquote>
        </figure>
      )}
      {item.url !== null && (
        <p className="flex flex-col gap-1 text-small">
          <span className="text-muted">{t('knowledge.check.page')}</span>
          <span className="font-mono break-all">{item.url}</span>
        </p>
      )}
      {item.note !== null && <p>{t('knowledge.check.note', { note: item.note })}</p>}
    </div>
  );
}
