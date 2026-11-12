import {
  type KnowledgeVersion,
  maxAutomaticStartsPerDay,
  maxQuotes,
  routes,
  type VersionCheckReport,
  type VersionView,
} from '@arca/api-contract/client';
import { Button, Disclosure, Icon, StatusChip, type StatusTone } from '@arca/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api, versionCheckQuery } from '../api.js';
import { checkFold } from './check-fold.js';
import type { HandCheck } from './hand-checks.js';
import { card, surface } from './review-parts.js';
import { pointTone } from './step-checks.js';
import { PointMark } from './step-nav.js';
import type { KnowledgeWords } from './words.js';

type ListedCheck = KnowledgeVersion['check'];
type ReportItem = VersionCheckReport['items'][number];

/**
 * Starts the checks that are due once per visit to the screen, after the list loaded (ADR-0027):
 * the server picks the versions and keeps the automatic share, so the screen sends no identities. A
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

/** A scripted report's matches are a test's, never a confirmation, so none shows as one. */
function itemTone(status: ReportItem['status'], scripted: boolean): StatusTone {
  if (status === 'matches') return scripted ? 'unknown' : 'ok';
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
  startsOpen = false,
  level = 5,
}: {
  readonly view: VersionView;
  readonly words: KnowledgeWords;
  /** Open whatever the status, where the report is what the admin came to read. */
  readonly startsOpen?: boolean;
  /** The panel's heading level, which follows the screen's outline. */
  readonly level?: 4 | 5;
}) {
  const { t } = words;
  const check = useQuery(versionCheckQuery(view.routeId, view.number));
  const status = check.data?.enabled === true ? check.data.status : undefined;
  const folded = checkFold(check.isPending, status);
  const fold = startsOpen ? { ...folded, defaultOpen: true } : folded;
  return (
    <Disclosure
      key={fold.key}
      title={t('knowledge.check.title')}
      level={level}
      icon="ai"
      aside={status !== undefined && <CheckChip status={status} words={words} />}
      defaultOpen={fold.defaultOpen}
      footer={
        status !== undefined && (
          <p className="text-small text-muted">{t('knowledge.check.footer', { max: maxQuotes })}</p>
        )
      }
      className={card}
    >
      {check.isError ? (
        <div className="flex flex-col items-start gap-2">
          <p>{t('knowledge.check.loadFailure')}</p>
          <Button variant="secondary" onClick={() => void check.refetch()}>
            {t('knowledge.retry')}
          </Button>
        </div>
      ) : check.data === undefined ? null : !check.data.enabled ? (
        <p>{t('knowledge.check.off')}</p>
      ) : check.data.report === null ? (
        // Polite, not a status: the decision below keeps the screen's one status message.
        <div aria-live="polite" className="flex flex-col gap-1">
          <p>{t('knowledge.check.status', { status: check.data.status })}</p>
          {view.state === 'proposed' && check.data.status !== 'running' && (
            <p className="text-small text-muted">
              {t('knowledge.check.startsOnOpen', { max: maxAutomaticStartsPerDay })}
            </p>
          )}
        </div>
      ) : (
        <ReportBody
          report={check.data.report}
          country={view.country}
          words={words}
          subheading={level === 4 ? 'h5' : 'h6'}
        />
      )}
    </Disclosure>
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
  subheading: Subheading,
}: {
  readonly report: VersionCheckReport;
  readonly country: string;
  readonly words: KnowledgeWords;
  readonly subheading: 'h5' | 'h6';
}) {
  const { t } = words;
  const problems = report.fetchLog.filter(({ outcome, cut }) => outcome !== 'read' || cut);
  const addressRead = addressesRead(report);
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
              <ReportItemCard
                item={item}
                scripted={report.scripted}
                addressRead={addressRead}
                words={words}
              />
            </li>
          ))}
        </ul>
      )}
      {problems.length > 0 && (
        <div className="flex flex-col gap-2">
          <Subheading className="font-medium">{t('knowledge.check.pages')}</Subheading>
          <ul className="flex flex-col gap-2">
            {problems.map(({ url, machineReadableUrl, outcome, status }) => (
              <li key={url} className="flex flex-col gap-1 text-small">
                <span>
                  {t('knowledge.check.outcome', { outcome, status: String(status ?? '') })}
                </span>
                <span className="font-mono break-all text-muted">{url}</span>
                <AddressRead address={machineReadableUrl} words={words} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/**
 * The address a page's text was read at, when not the page itself: plain text, as every URL here,
 * so the admin can tell a quote came from a data address and open it to see the words.
 */
function AddressRead({
  address,
  words,
}: {
  readonly address: string | null | undefined;
  readonly words: KnowledgeWords;
}) {
  if (address === null || address === undefined) return null;
  return (
    <>
      <span className="text-muted">{words.t('knowledge.check.readAt')}</span>
      <span className="font-mono break-all">{address}</span>
    </>
  );
}

function ReportItemCard({
  item,
  scripted,
  addressRead,
  words,
}: {
  readonly item: ReportItem;
  readonly scripted: boolean;
  readonly addressRead: ReadonlyMap<string, string | null>;
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
          tone={itemTone(item.status, scripted)}
          label={t('knowledge.check.itemStatus', { status: item.status })}
        />
      </div>
      {item.reason !== null && (
        <p>{t('knowledge.check.reason', { reason: item.reason, max: maxQuotes })}</p>
      )}
      <Quotes item={item} addressRead={addressRead} words={words} />
      {item.note !== null && <p>{t('knowledge.check.note', { note: item.note })}</p>}
      {item.status === 'could_not_check' && item.citations.length > 0 && (
        <LookHere item={item} words={words} />
      )}
    </div>
  );
}

/** The verified passages an item rests on, each with its page: plain text, never links. */
function Quotes({
  item,
  addressRead,
  words,
}: {
  readonly item: ReportItem;
  readonly addressRead: ReadonlyMap<string, string | null>;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  return item.quotes.map(({ quote, url }, index) => (
    <figure key={`${String(index)}-${url}`} className="flex flex-col gap-1">
      <figcaption className="text-small text-muted">
        {t('knowledge.check.quote', { n: index + 1, total: item.quotes.length })}
      </figcaption>
      <blockquote className="border-l-2 border-line pl-3 whitespace-pre-wrap">{quote}</blockquote>
      <p className="flex flex-col gap-1 text-small">
        <span className="text-muted">{t('knowledge.check.page')}</span>
        <span className="font-mono break-all">{url}</span>
        <AddressRead address={addressRead.get(url)} words={words} />
      </p>
    </figure>
  ));
}

/** The address each page of a report was read at, by the page's URL. */
export const addressesRead = (
  report: Pick<VersionCheckReport, 'fetchLog'>,
): ReadonlyMap<string, string | null> =>
  new Map(report.fetchLog.map(({ url, machineReadableUrl }) => [url, machineReadableUrl]));

/** Where to look and what to look for, from the bundled version: links only to its official pages. */
function LookHere({ item, words }: { readonly item: ReportItem; readonly words: KnowledgeWords }) {
  const { t } = words;
  const values = item.values.map(({ kind, value }) =>
    kind === 'date' ? words.date(value) : words.decimal(value),
  );
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium">{t('knowledge.points.lookAt')}</p>
      <ul className="flex flex-col gap-1">
        {item.citations.map(({ url, title }, index) => (
          <li key={`${String(index)}-${url}`}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline"
            >
              {title}
            </a>{' '}
            <span className="text-small text-muted">{t('knowledge.points.opensSite')}</span>
          </li>
        ))}
      </ul>
      {values.length > 0 && <p>{t('knowledge.points.lookFor', { values: words.list(values) })}</p>}
    </div>
  );
}

/** The admin's own mark on an item to check by hand, kept on this device. */
function HandCheckToggle({
  handCheck,
  words,
}: {
  readonly handCheck: HandCheck;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button variant="secondary" aria-pressed={handCheck.checked} onClick={handCheck.toggle}>
        {handCheck.checked && <Icon name="check" size={16} />}
        {t('knowledge.points.handCheck')}
      </Button>
      <span className="text-small text-muted">{t('knowledge.points.handCheckNote')}</span>
    </div>
  );
}

/**
 * One checked point under the rule item it is about: how it came out, why, the model's note and
 * the passages, folded unless the point differs. Model output, shown as plain text. A point the
 * check could not confirm reads as one to check yourself, with the official pages to open and the
 * values to find there, never as an error.
 */
export function ItemResult({
  item,
  addressRead,
  words,
  handCheck,
}: {
  readonly item: ReportItem;
  readonly addressRead: ReadonlyMap<string, string | null>;
  readonly words: KnowledgeWords;
  readonly handCheck?: HandCheck;
}) {
  const { t } = words;
  const yours = item.status === 'could_not_check';
  return (
    <div className="flex items-start gap-3 border-t border-line pt-3">
      <PointMark tone={pointTone(item.status)} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p>
          <span className="font-medium">
            {t('knowledge.points.status', { status: item.status })}
          </span>
          {item.reason !== null && (
            <span className={yours ? 'text-small text-muted' : undefined}>
              {' '}
              {t('knowledge.check.reason', { reason: item.reason, max: maxQuotes })}
            </span>
          )}
        </p>
        {item.note !== null && <p>{t('knowledge.check.note', { note: item.note })}</p>}
        {yours && item.citations.length > 0 && <LookHere item={item} words={words} />}
        {yours && handCheck !== undefined && (
          <HandCheckToggle handCheck={handCheck} words={words} />
        )}
        {item.quotes.length > 0 && (
          <details open={item.status === 'differs'}>
            <summary className="cursor-pointer text-small text-accent">
              {t('knowledge.points.quotes', { n: item.quotes.length })}
            </summary>
            <div className="mt-2 flex flex-col gap-3">
              <Quotes item={item} addressRead={addressRead} words={words} />
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
