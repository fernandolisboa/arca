import type { KnowledgeComparisonVersion, KnowledgeVersion } from '@arca/api-contract/client';
import { Disclosure, Icon, StatusChip, cardClass } from '@arca/ui';
import type { ReactNode } from 'react';
import { CountryFlag } from '../country-flag.js';
import { MemberRequestsSection } from './member-requests.js';
import { NewRouteRequestsSection } from './new-route-requests.js';
import { ReportsSection } from './reports-section.js';
import {
  type VersionTab,
  byRoute,
  comparisonTabs,
  reviewOrder,
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
    <StatusChip
      tone="unknown"
      label={words.t('knowledge.lists.previousState', { state: version.state })}
    />
  );
}

/**
 * One country's versions of a list as rows. A country with several routes (visas) puts each
 * route's versions under the route's name; one route alone needs none unless `named`, as in a
 * narrow column. Proposed rows are numbered in the order to review them.
 */
export function CountryRows({
  versions,
  tab,
  named: alwaysNamed = false,
  onPick,
  words,
}: {
  readonly versions: readonly KnowledgeVersion[];
  readonly tab: VersionTab;
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
        </span>
        {tab === 'previous' && <PreviousChip version={version} words={words} />}
        <Chevron />
      </button>
    </li>
  );
  if (!named) return ordered.map(row);
  return routes.map((route) => (
    <li key={route.routeId}>
      <p className="bg-soft px-4 py-2 text-small font-medium">{route.title}</p>
      <ol className="flex flex-col divide-y divide-line border-t border-line">
        {route.versions.map(row)}
      </ol>
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
        </span>
        {tab === 'previous' && <PreviousChip version={version} words={words} />}
        <Chevron />
      </button>
    </li>
  ));
}

const rowsClass = 'flex flex-col divide-y divide-line';

/** Rows inside a card with no heading of its own. */
export function RowsCard({ children }: { readonly children: ReactNode }) {
  return (
    <div className={`overflow-hidden ${cardClass}`}>
      <ol className={rowsClass}>{children}</ol>
    </div>
  );
}

/** A country's (or the comparisons') versions of a list, folded behind its name. */
function GroupCard({
  title,
  lead,
  count,
  open,
  onOpenChange,
  words,
  children,
}: {
  readonly title: string;
  readonly lead?: ReactNode;
  readonly count: number;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly words: KnowledgeWords;
  readonly children: ReactNode;
}) {
  return (
    <Disclosure
      title={title}
      lead={lead}
      level={4}
      open={open}
      onOpenChange={onOpenChange}
      aside={
        <span className="flex basis-full flex-wrap items-center gap-2 pb-3">
          <span className="text-small text-muted">
            {words.t('knowledge.review.versions', { n: count })}
          </span>
        </span>
      }
      className={`overflow-hidden px-4 ${cardClass}`}
    >
      <ol className={`-mx-4 border-t border-line ${rowsClass}`}>{children}</ol>
    </Disclosure>
  );
}

/**
 * One list as a card per country, in name order, the comparisons last. `isOpen` and `onOpenChange`
 * keep each card's fold in the screen, keyed by country.
 */
export function CountryCards({
  tab,
  lists,
  columns,
  isOpen,
  onOpenChange,
  onPick,
  words,
}: {
  readonly tab: VersionTab;
  readonly lists: TabLists;
  readonly columns: string;
  readonly isOpen: (key: string) => boolean;
  readonly onOpenChange: (key: string, open: boolean) => void;
  readonly onPick: (picked: Picked) => void;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const groups = reviewOrder(lists.versions, words.country);
  if (groups.length === 0 && lists.comparisons.length === 0) {
    return <p className="text-muted">{t(`knowledge.lists.empty.${tab}`)}</p>;
  }
  return (
    <div className={`grid items-start gap-3 ${columns}`}>
      {groups.map(({ country, versions }) => (
        <GroupCard
          key={country}
          title={words.country(country)}
          lead={<CountryFlag code={country} />}
          count={versions.length}
          open={isOpen(country)}
          onOpenChange={(open) => {
            onOpenChange(country, open);
          }}
          words={words}
        >
          <CountryRows versions={versions} tab={tab} onPick={onPick} words={words} />
        </GroupCard>
      ))}
      {lists.comparisons.length > 0 && (
        <GroupCard
          title={t('knowledge.review.comparisons')}
          count={lists.comparisons.length}
          open={isOpen(comparisonsKey)}
          onOpenChange={(open) => {
            onOpenChange(comparisonsKey, open);
          }}
          words={words}
        >
          <ComparisonRows comparisons={lists.comparisons} tab={tab} onPick={onPick} words={words} />
        </GroupCard>
      )}
    </div>
  );
}

/**
 * Reports, members' requests and requests for new routes, all of them or one country's. Each
 * request is about a country: a report or member's request through its route's version.
 */
export function RequestSections({
  versions,
  country,
  className,
  words,
  onOpenVersion,
}: {
  readonly versions: readonly KnowledgeVersion[];
  readonly country?: string;
  readonly className: string;
  readonly words: KnowledgeWords;
  readonly onOpenVersion: (routeId: string, number: number) => void;
}) {
  const scope = country === undefined ? {} : { country };
  return (
    <div className={className}>
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
