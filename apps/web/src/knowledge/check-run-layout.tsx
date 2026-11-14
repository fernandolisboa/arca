import type { CheckProgress, VersionCheckReport } from '@arca/api-contract/client';
import { Button, Icon, StatusChip, Tabs, buttonClass, cardClass, tabPanelProps } from '@arca/ui';
import { type ReactNode, useId, useState } from 'react';
import { checkRunItems } from './check-run-steps.js';
import { CheckRunPages } from './check-run.js';
import { ReportItemCard, ReportPageNotes, ReportSummary, itemTone, pageReadsOf } from './checks.js';
import { type ReportItem, shownPoints } from './step-checks.js';
import type { KnowledgeWords } from './words.js';

type ItemStatus = ReportItem['status'];
type Filter = ItemStatus | 'all';
const filters: readonly Filter[] = ['all', 'differs', 'could_not_check', 'matches'];

/** On a wide screen a column keeps its own scroll, so the page never grows past the window. */
const column = `${cardClass} flex min-w-0 flex-col gap-3 p-4 sm:p-5 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-7rem)]`;
const detailColumn = 'flex min-w-0 flex-col gap-3 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-7rem)]';
const scroller = 'min-h-0 lg:flex-1 lg:overflow-y-auto';

function ItemRow({
  item,
  words,
}: {
  readonly item: Pick<ReportItem, 'kind' | 'status' | 'title'>;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  return (
    <>
      <span className="flex min-w-0 flex-col">
        <span className="text-small text-muted">
          {t('knowledge.check.kind', { kind: item.kind })}
        </span>
        <span className="font-medium">{item.title}</span>
      </span>
      <StatusChip
        tone={itemTone(item.status, false)}
        label={t('knowledge.check.itemStatus', { status: item.status })}
      />
    </>
  );
}

const rowClass = 'flex w-full items-start justify-between gap-3 px-2 py-2.5 text-left';

/**
 * A check that has not left a report to read: the items as their answers land beside the pages
 * as they are read, so neither list pushes the other down the screen.
 */
export function CheckRunLive({
  progress,
  words,
}: {
  readonly progress: CheckProgress;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const { answered, next, left } = checkRunItems(progress);
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <ScrollColumn title={t('knowledge.checkRun.items')}>
        {answered.length === 0 && next === undefined && (
          <p className="text-small text-muted">{t('knowledge.checkRun.noItems')}</p>
        )}
        {answered.length > 0 && (
          <ul aria-label={t('knowledge.checkRun.comparedItems')} className="flex flex-col">
            {answered.map((item) => (
              <li
                key={item.key}
                className={`${rowClass} animate-row-land border-t border-line first:border-t-0`}
              >
                <ItemRow item={item} words={words} />
              </li>
            ))}
          </ul>
        )}
        {/* Polite, so a screen reader hears which item is next without losing its place. */}
        <div role="status" className="flex flex-col gap-2">
          {next !== undefined && (
            <p className="flex items-center gap-3 border-t border-line px-2 pt-3 text-small">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 animate-stage-pulse rounded-full bg-primary"
              />
              <span className="min-w-0">
                {t('knowledge.checkRun.awaiting', { title: next.title })}
              </span>
            </p>
          )}
          {left > 0 && (
            <p className="px-2 text-small text-muted">
              {t('knowledge.checkRun.left', { n: left })}
            </p>
          )}
        </div>
      </ScrollColumn>
      <ScrollColumn title={t('knowledge.checkRun.pages')}>
        <CheckRunPages progress={progress} words={words} />
      </ScrollColumn>
    </div>
  );
}

function ScrollColumn({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={column}>
      <h3 id={titleId} className="font-medium">
        {title}
      </h3>
      {/* Focusable, so the column scrolls from the keyboard too. */}
      <div tabIndex={0} className={scroller}>
        {children}
      </div>
    </section>
  );
}

/**
 * A finished check's report as a list beside the item it opens: filters lead to what differs,
 * and an item's quotes and notes open beside the list, not under the next one. On a phone the
 * item takes the screen, with a way back to the list.
 */
export function CheckRunReport({
  report,
  progress,
  country,
  words,
}: {
  readonly report: VersionCheckReport;
  readonly progress: CheckProgress;
  readonly country: string;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const tabsId = useId();
  const items = shownPoints(report);
  const [tab, setTab] = useState<'items' | 'pages'>('items');
  const [filter, setFilter] = useState<Filter>('all');
  const [picked, setPicked] = useState<string | null>(null);
  const shown = filter === 'all' ? items : items.filter(({ status }) => status === filter);
  const firstWorthAlook = items.find(({ status }) => status !== 'matches') ?? items[0];
  const open = items.find(({ key }) => key === (picked ?? firstWorthAlook?.key));
  const countOf = (each: Filter) =>
    each === 'all' ? items.length : items.filter(({ status }) => status === each).length;
  const pageReads = pageReadsOf(report);

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section
        aria-label={t('knowledge.checkRun.result')}
        className={`${column} ${picked === null ? '' : 'max-lg:hidden'}`}
      >
        <div className="flex shrink-0 flex-col gap-1">
          <ReportSummary report={report} country={country} words={words} />
        </div>
        <Tabs
          className="shrink-0"
          label={t('knowledge.checkRun.lists')}
          idBase={tabsId}
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'items', label: t('knowledge.checkRun.items'), count: items.length },
            { value: 'pages', label: t('knowledge.checkRun.pages'), count: progress.pages.length },
          ]}
        />
        <div {...tabPanelProps(tabsId, tab)} className={`flex flex-col gap-3 ${scroller}`}>
          {tab === 'items' ? (
            <>
              <div
                role="group"
                aria-label={t('knowledge.checkRun.filter')}
                className="flex flex-wrap gap-2"
              >
                {filters
                  .filter((each) => each === 'all' || countOf(each) > 0)
                  .map((each) => (
                    <Button
                      key={each}
                      variant={filter === each ? 'primary' : 'secondary'}
                      aria-pressed={filter === each}
                      onClick={() => {
                        setFilter(each);
                      }}
                    >
                      {t('knowledge.checkRun.filterStatus', { status: each })}
                      <span className="text-small opacity-80">{countOf(each)}</span>
                    </Button>
                  ))}
              </div>
              <ul className="flex flex-col">
                {shown.map((item) => (
                  <li key={item.key} className="border-t border-line first:border-t-0">
                    <button
                      type="button"
                      aria-current={item.key === open?.key ? 'true' : undefined}
                      onClick={() => {
                        setPicked(item.key);
                      }}
                      className={`${rowClass} rounded-control hover:bg-soft focus-visible:outline-2 focus-visible:outline-primary ${item.key === open?.key ? 'lg:bg-soft' : ''}`}
                    >
                      <ItemRow item={item} words={words} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <CheckRunPages progress={progress} words={words} />
              <ReportPageNotes report={report} words={words} subheading="h4" />
            </>
          )}
        </div>
      </section>
      {open !== undefined && (
        <section
          aria-label={open.title}
          className={`${detailColumn} ${picked === null ? 'max-lg:hidden' : ''}`}
        >
          <button
            type="button"
            className={`${buttonClass('secondary')} self-start lg:hidden`}
            onClick={() => {
              setPicked(null);
            }}
          >
            <Icon name="back" size={18} />
            {t('knowledge.checkRun.backToList')}
          </button>
          <div tabIndex={0} className={scroller}>
            <ReportItemCard
              item={open}
              scripted={report.scripted}
              pageReads={pageReads}
              words={words}
            />
          </div>
        </section>
      )}
    </div>
  );
}
