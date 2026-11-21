import type { KnowledgeComparisonVersion, KnowledgeVersion } from '@arca/api-contract/client';
import { Icon, StatusChip, cardClass } from '@arca/ui';
import { CountryFlag } from '../country-flag.js';
import { Fold, foldCardClass } from './folds.js';
import { MemberRequestsSection } from './member-requests.js';
import { NewRouteRequestsSection } from './new-route-requests.js';
import { ReportsSection } from './reports-section.js';
import {
  type VersionTab,
  byRoute,
  comparisonTabs,
  reviewOrder,
  versionSpan,
  versionTab,
} from './review-order.js';
import { RouteRequestsSection } from './route-requests.js';
import type { KnowledgeWords } from './words.js';

/** The version picked for review: a route version or a comparison version (ADR-0026). */
export type Picked =
  | { readonly subject: 'route'; readonly routeId: string; readonly number: number }
  | { readonly subject: 'comparison'; readonly comparisonId: string; readonly number: number };

export const pickedKey = (picked: Picked) =>
  picked.subject === 'route'
    ? `route:${picked.routeId}:${String(picked.number)}`
    : `comparison:${picked.comparisonId}:${String(picked.number)}`;

/** The key the comparisons take where a country code would, which no country code can be. */
export const comparisonsKey = 'comparisons';

/** The versions and comparisons of one list. */
export interface TabLists {
  readonly versions: readonly KnowledgeVersion[];
  readonly comparisons: readonly KnowledgeComparisonVersion[];
}

export function listOf(
  tab: VersionTab,
  versions: readonly KnowledgeVersion[],
  comparisons: readonly KnowledgeComparisonVersion[],
): TabLists {
  const tabs = comparisonTabs(comparisons);
  return {
    versions: versions.filter((version) => versionTab(version) === tab),
    comparisons: comparisons.filter((version) => tabs.get(version) === tab),
  };
}

export function listsByTab(
  versions: readonly KnowledgeVersion[],
  comparisons: readonly KnowledgeComparisonVersion[],
): Record<VersionTab, TabLists> {
  return {
    proposed: listOf('proposed', versions, comparisons),
    active: listOf('active', versions, comparisons),
    previous: listOf('previous', versions, comparisons),
  };
}

export const countOf = (lists: TabLists) => lists.versions.length + lists.comparisons.length;

export function countsByTab(lists: Record<VersionTab, TabLists>): Record<VersionTab, number> {
  return {
    proposed: countOf(lists.proposed),
    active: countOf(lists.active),
    previous: countOf(lists.previous),
  };
}

const rowButton =
  'flex min-h-touch w-full items-start gap-3 px-4 py-3 text-left hover:bg-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary';

/** A row's chevron, the one look every row shares. */
function Chevron() {
  return (
    <span aria-hidden="true" className="self-center text-muted">
      <Icon name="chevron" size={16} />
    </span>
  );
}

/** How a previous version left use, as a chip; nothing on the other lists. */
function PreviousChip({
  version,
  words,
}: {
  readonly version: Pick<KnowledgeVersion, 'state'>;
  readonly words: KnowledgeWords;
}) {
  return (
    <span className="self-start">
      <StatusChip
        tone="unknown"
        label={words.t('knowledge.lists.previousState', { state: version.state })}
      />
    </span>
  );
}

/** What a folded group of route versions says: how many, from when, and how previous ones left. */
export function spanSummary(
  versions: readonly KnowledgeVersion[],
  tab: VersionTab,
  words: KnowledgeWords,
): string {
  const { t } = words;
  const { count, from, to, rejected, superseded } = versionSpan(versions);
  const counted = t('knowledge.review.versions', { n: count });
  const span =
    from === null || to === null
      ? counted
      : from === to
        ? t('knowledge.lists.summary.one', { versions: counted, date: words.date(from) })
        : t('knowledge.lists.summary.range', {
            versions: counted,
            from: words.date(from),
            to: words.date(to),
          });
  if (tab !== 'previous') return span;
  const outcomes = [
    ...(superseded > 0 ? [t('knowledge.lists.summary.superseded', { n: superseded })] : []),
    ...(rejected > 0 ? [t('knowledge.lists.summary.rejected', { n: rejected })] : []),
  ];
  return outcomes.length === 0
    ? span
    : t('knowledge.lists.summary.outcomes', { span, outcomes: words.list(outcomes) });
}

/**
 * One country's versions of a list as rows. A country with several routes (visas) puts each
 * route's versions under the route's name, which folds; one route alone needs none unless `named`,
 * as in a narrow column. Proposed rows are numbered in the order to review them. `foldId` keys
 * each route's fold.
 */
export function CountryRows({
  versions,
  tab,
  foldId,
  named: alwaysNamed = false,
  onPick,
  words,
}: {
  readonly versions: readonly KnowledgeVersion[];
  readonly tab: VersionTab;
  readonly foldId: string;
  readonly named?: boolean;
  readonly onPick: (picked: Picked) => void;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const routes = byRoute(versions);
  const named = alwaysNamed || routes.length > 1;
  const ordered = routes.flatMap((route) => route.versions);
  const row = (version: KnowledgeVersion) => (
    <li key={`${version.routeId}:${String(version.number)}`}>
      <button
        type="button"
        className={rowButton}
        onClick={() => {
          onPick({ subject: 'route', routeId: version.routeId, number: version.number });
        }}
      >
        {tab === 'proposed' && (
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-full bg-soft text-small font-medium tabular-nums"
          >
            {ordered.indexOf(version) + 1}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-medium">
            {named ? (
              <>
                <span className="sr-only">
                  {t('knowledge.versionTitle', { title: version.title, number: version.number })}
                </span>
                <span aria-hidden="true">
                  {t('knowledge.review.versionNumber', { number: version.number })}
                </span>
              </>
            ) : (
              t('knowledge.versionTitle', { title: version.title, number: version.number })
            )}
          </span>
          <span className="text-small text-muted">
            {t('knowledge.lists.from', { date: words.date(version.effectiveFrom) })}
          </span>
          {tab === 'previous' && <PreviousChip version={version} words={words} />}
        </span>
        <Chevron />
      </button>
    </li>
  );
  if (!named) return ordered.map(row);
  return routes.map((route) => (
    <li key={route.routeId}>
      <Fold
        id={`${foldId}:${route.routeId}`}
        fallback
        title={route.title}
        level={5}
        summary={spanSummary(route.versions, tab, words)}
        className="bg-soft px-4 text-small [&_ol]:bg-surface"
      >
        <ol className={`-mx-4 border-t border-line ${rowsClass}`}>{route.versions.map(row)}</ol>
      </Fold>
    </li>
  ));
}

/** Comparison versions of a list as rows. */
export function ComparisonRows({
  comparisons,
  tab,
  onPick,
  words,
}: {
  readonly comparisons: readonly KnowledgeComparisonVersion[];
  readonly tab: VersionTab;
  readonly onPick: (picked: Picked) => void;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  return comparisons.map((version) => (
    <li key={`${version.comparisonId}:${String(version.number)}`}>
      <button
        type="button"
        className={rowButton}
        onClick={() => {
          onPick({
            subject: 'comparison',
            comparisonId: version.comparisonId,
            number: version.number,
          });
        }}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-medium">
            {t('knowledge.versionTitle', { title: version.title, number: version.number })}
          </span>
          <span className="text-small text-muted">{t('knowledge.comparison.meta')}</span>
          {tab === 'previous' && <PreviousChip version={version} words={words} />}
        </span>
        <Chevron />
      </button>
    </li>
  ));
}

export const rowsClass = 'flex flex-col divide-y divide-line';

/** The surface of a foldable card whose rows run edge to edge. */
export const foldingCardClass = `overflow-hidden px-4 ${cardClass} ${foldCardClass}`;

/**
 * One list as a foldable card per country, in name order, the comparisons last, set in a masonry
 * of `columns`. A card starts open on a wide screen and folded on a phone.
 */
export function CountryCards({
  tab,
  lists,
  columns,
  wide,
  onPick,
  words,
}: {
  readonly tab: VersionTab;
  readonly lists: TabLists;
  readonly columns: string;
  readonly wide: boolean;
  readonly onPick: (picked: Picked) => void;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const groups = reviewOrder(lists.versions, words.country);
  if (groups.length === 0 && lists.comparisons.length === 0) {
    return <p className="text-muted">{t(`knowledge.lists.empty.${tab}`)}</p>;
  }
  return (
    <div className={`gap-3 ${columns}`}>
      {groups.map(({ country, versions }) => (
        <Fold
          key={country}
          id={`cards:${tab}:${country}`}
          fallback={wide}
          title={words.country(country)}
          lead={<CountryFlag code={country} />}
          count={versions.length}
          summary={spanSummary(versions, tab, words)}
          className={foldingCardClass}
        >
          <ol className={`-mx-4 border-t border-line ${rowsClass}`}>
            <CountryRows
              versions={versions}
              tab={tab}
              foldId={`cards:${tab}:${country}`}
              onPick={onPick}
              words={words}
            />
          </ol>
        </Fold>
      ))}
      {lists.comparisons.length > 0 && (
        <Fold
          id={`cards:${tab}:${comparisonsKey}`}
          fallback={wide}
          title={t('knowledge.review.comparisons')}
          count={lists.comparisons.length}
          summary={t('knowledge.review.versions', { n: lists.comparisons.length })}
          className={foldingCardClass}
        >
          <ol className={`-mx-4 border-t border-line ${rowsClass}`}>
            <ComparisonRows
              comparisons={lists.comparisons}
              tab={tab}
              onPick={onPick}
              words={words}
            />
          </ol>
        </Fold>
      )}
    </div>
  );
}

/**
 * Reports, members' requests and requests for new routes, all of them or one country's, each a
 * foldable card in a masonry of `columns`. Each request is about a country: a report or member's
 * request through its route's version.
 */
export function RequestSections({
  versions,
  country,
  columns,
  words,
  onOpenVersion,
}: {
  readonly versions: readonly KnowledgeVersion[];
  readonly country?: string;
  readonly columns: string;
  readonly words: KnowledgeWords;
  readonly onOpenVersion: (routeId: string, number: number) => void;
}) {
  const scope = country === undefined ? {} : { country };
  return (
    <div className={`gap-3 ${columns}`}>
      <ReportsSection versions={versions} {...scope} words={words} />
      <MemberRequestsSection
        versions={versions}
        {...scope}
        words={words}
        onOpenVersion={onOpenVersion}
      />
      <NewRouteRequestsSection {...scope} words={words} onOpenVersion={onOpenVersion} />
      <RouteRequestsSection {...scope} words={words} onOpenVersion={onOpenVersion} />
    </div>
  );
}
