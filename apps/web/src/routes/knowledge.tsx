import {
  ApiError,
  type KnowledgeComparisonVersion,
  type KnowledgeVersion,
} from '@arca/api-contract/client';
import {
  Button,
  Icon,
  LayoutToggle,
  Tabs,
  cardClass,
  iconButtonClass,
  tabPanelProps,
  wideQuery,
  type LayoutOption,
} from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  comparisonViewQuery,
  knowledgeVersionsQuery,
  memberUpdateRequestsQuery,
  newRouteRequestsQuery,
  routeRequestsQuery,
  ruleReportsQuery,
  sessionQuery,
  versionViewQuery,
} from '../api.js';
import { CountryFlag } from '../country-flag.js';
import { textLinkClass } from '../forms/text-link.js';
import { ComparisonPanel } from '../knowledge/comparison-panel.js';
import { Fold, FoldsContext, useFolds, useFoldsContext } from '../knowledge/folds.js';
import { OpenRouteVersionContext } from '../knowledge/corrections.js';
import { byRequirement } from '../knowledge/reports-section.js';
import {
  type CountryRequest,
  type CountryTally,
  type VersionTab,
  countryOfRoute,
  countryTallies,
  versionTabs,
} from '../knowledge/review-order.js';
import { VersionPanel } from '../knowledge/version-panel.js';
import {
  ComparisonRows,
  CountryCards,
  CountryRows,
  type Picked,
  RequestSections,
  comparisonsKey,
  countOf,
  countsByTab,
  foldRowsClass,
  foldingCardClass,
  listsByTab,
  pickedKey,
  spanSummary,
} from '../knowledge/version-lists.js';
import { type KnowledgeWords, useKnowledgeWords } from '../knowledge/words.js';
import { Page } from '../page.js';
import { storedChoice } from '../stored-choice.js';
import { useMediaQuery } from '../use-media-query.js';

export const Route = createFileRoute('/knowledge')({ component: Knowledge });

/** How a wide screen lays out the lists; a phone always gets the grid's tabs, countries folded. */
const layouts = ['countries', 'grid', 'side'] as const;
type Layout = (typeof layouts)[number];
const storedLayout = storedChoice<Layout>('arca.knowledge-layout', layouts, 'countries');
const layoutIcons = { countries: 'sideList', grid: 'cards', side: 'sidePanel' } as const;

type Section = 'rules' | 'requests';

/** Where the admin is in the lists, kept while a version is open so coming back lands there. */
interface ListPlace {
  readonly section: Section;
  readonly tab: VersionTab;
  /** The country (or the comparisons) picked in the country layout; null for the default. */
  readonly country: string | null;
}

const gridColumns = 'md:columns-2 xl:columns-3 2xl:columns-4';
const sideColumns = 'md:columns-2';
const requestColumns = 'md:columns-2 2xl:columns-4';
const countryRequestColumns = 'md:columns-2';
/** The counts beside each country, in order. */
const tallyKeys = [...versionTabs, 'waiting'] as const;
const foldAllActions = ['expandAll', 'collapseAll'] as const;

/** The activation screen (spec 0007, R7): versions split into lists, each grouped by country. */
function Knowledge() {
  const words = useKnowledgeWords();
  const { t } = words;
  const session = useQuery(sessionQuery);
  const admin = session.data?.admin === true;
  const versions = useQuery({ ...knowledgeVersionsQuery, enabled: admin });
  const [picked, setPicked] = useState<Picked | null>(null);
  const [place, setPlace] = useState<ListPlace>({
    section: 'rules',
    tab: 'proposed',
    country: null,
  });
  const folds = useFolds();
  const openRouteVersion = useCallback((number: number) => {
    setPicked((current) => (current?.subject === 'route' ? { ...current, number } : current));
  }, []);
  const title = t('knowledge.title');
  if (session.isError) {
    return (
      <Page narrow title={title}>
        <p>{t('knowledge.signIn')}</p>
        <Link to="/sign-in" className={textLinkClass}>
          {t('session.signIn')}
        </Link>
      </Page>
    );
  }
  if (
    (session.isSuccess && !admin) ||
    (versions.error instanceof ApiError && versions.error.status === 403)
  ) {
    return (
      <Page narrow title={title}>
        <p>{t('knowledge.notAdmin')}</p>
      </Page>
    );
  }
  if (versions.isError) {
    return (
      <Page narrow title={title}>
        <p>{t('knowledge.loadFailure')}</p>
        <Button onClick={() => void versions.refetch()}>{t('knowledge.retry')}</Button>
      </Page>
    );
  }
  if (versions.data === undefined) return <Page narrow title={title} />;
  if (picked !== null) {
    return (
      <Page title={title}>
        <button
          type="button"
          className={`${textLinkClass} self-start`}
          onClick={() => {
            setPicked(null);
          }}
        >
          {t('knowledge.back')}
        </button>
        {picked.subject === 'route' ? (
          <OpenRouteVersionContext value={openRouteVersion}>
            <PickedVersion
              key={pickedKey(picked)}
              routeId={picked.routeId}
              number={picked.number}
            />
          </OpenRouteVersionContext>
        ) : (
          <PickedComparison
            key={pickedKey(picked)}
            comparisonId={picked.comparisonId}
            number={picked.number}
          />
        )}
      </Page>
    );
  }
  return (
    <Page title={title} lead={t('knowledge.lead')}>
      <FoldsContext value={folds}>
        <VersionLists
          versions={versions.data.versions}
          comparisons={versions.data.comparisons}
          place={place}
          onPlaceChange={setPlace}
          onPick={setPicked}
          words={words}
        />
      </FoldsContext>
    </Page>
  );
}

/** Every request and report as the country it is about, for the counts beside each country. */
function useCountryRequests(versions: readonly KnowledgeVersion[]): readonly CountryRequest[] {
  const reports = useQuery(ruleReportsQuery);
  const members = useQuery(memberUpdateRequestsQuery);
  const newRoutes = useQuery(newRouteRequestsQuery);
  const routeRequests = useQuery(routeRequestsQuery);
  const viaRoute = (routeId: string, waiting: boolean) => {
    const country = countryOfRoute(versions, routeId);
    return country === undefined ? [] : [{ country, waiting }];
  };
  return [
    ...byRequirement(reports.data?.reports ?? []).flatMap(({ routeId }) => viaRoute(routeId, true)),
    ...(members.data?.requests ?? []).flatMap(({ routeId, canRelease }) =>
      viaRoute(routeId, canRelease),
    ),
    ...(newRoutes.data?.requests ?? []).map(({ country }) => ({
      country: country.toUpperCase(),
      waiting: false,
    })),
    ...(routeRequests.data?.requests ?? []).map(({ countryCode }) => ({
      country: countryCode.toUpperCase(),
      waiting: false,
    })),
  ];
}

/** Two icon buttons that open or fold every card on the screen. */
function FoldAll({ words }: { readonly words: KnowledgeWords }) {
  const { t } = words;
  const folds = useFoldsContext();
  return (
    <div
      role="group"
      aria-label={t('knowledge.lists.folds')}
      className="inline-flex shrink-0 gap-0.5 rounded-control border border-line bg-surface p-0.5"
    >
      {foldAllActions.map((action) => {
        const label = t(`knowledge.lists.${action}`);
        return (
          <button
            key={action}
            type="button"
            aria-label={label}
            title={label}
            className={`${iconButtonClass} text-muted hover:text-ink`}
            onClick={() => {
              folds.setAll(action === 'expandAll');
            }}
          >
            <Icon name={action} />
          </button>
        );
      })}
    </div>
  );
}

function VersionLists({
  versions,
  comparisons,
  place,
  onPlaceChange,
  onPick,
  words,
}: {
  readonly versions: readonly KnowledgeVersion[];
  readonly comparisons: readonly KnowledgeComparisonVersion[];
  readonly place: ListPlace;
  readonly onPlaceChange: (place: ListPlace) => void;
  readonly onPick: (picked: Picked) => void;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const wide = useMediaQuery(wideQuery);
  const [preferred, setPreferred] = useState(storedLayout.read);
  const layout: Layout = wide ? preferred : 'grid';
  const sectionsId = useId();
  const tabsId = useId();
  const requests = useCountryRequests(versions);
  const onOpenVersion = (routeId: string, number: number) => {
    onPick({ subject: 'route', routeId, number });
  };
  const tools = (
    <div className="flex shrink-0 items-center gap-2">
      <FoldAll words={words} />
      {wide && (
        <LayoutToggle
          label={t('knowledge.layout.label')}
          options={layouts.map((value): LayoutOption<Layout> => ({
            value,
            label: t(`knowledge.layout.${value}`),
            icon: layoutIcons[value],
          }))}
          value={preferred}
          onChange={(next) => {
            storedLayout.write(next);
            setPreferred(next);
          }}
        />
      )}
    </div>
  );
  const lists = listsByTab(versions, comparisons);
  const statusTabs = (
    <Tabs
      label={t('knowledge.lists.label')}
      tabs={versionTabs.map((key) => ({
        value: key,
        label: t(`knowledge.lists.${key}`),
        count: countOf(lists[key]),
      }))}
      value={place.tab}
      onChange={(tab) => {
        onPlaceChange({ ...place, tab });
      }}
      idBase={tabsId}
      className="min-w-0 flex-1"
    />
  );
  const statusPanel = (columns: string) => (
    <div {...tabPanelProps(tabsId, place.tab)} className="flex flex-col gap-4 outline-none">
      <p className="text-small text-muted">{t(`knowledge.lists.lead.${place.tab}`)}</p>
      <CountryCards
        tab={place.tab}
        lists={lists[place.tab]}
        columns={columns}
        wide={wide}
        onPick={onPick}
        words={words}
      />
    </div>
  );
  if (layout === 'side') {
    const requestsTitle = t('knowledge.lists.requestsTitle');
    return (
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex items-end justify-between gap-4">
            {statusTabs}
            {tools}
          </div>
          {statusPanel(sideColumns)}
        </div>
        <section aria-label={requestsTitle} className="flex min-w-0 flex-col gap-4">
          <h3 className="font-display text-lead">{requestsTitle}</h3>
          <RequestSections versions={versions} words={words} onOpenVersion={onOpenVersion} />
        </section>
      </div>
    );
  }
  const { section } = place;
  const waiting = requests.filter((request) => request.waiting).length;
  const body =
    layout === 'countries' ? (
      <CountryLayout
        section={section}
        versions={versions}
        comparisons={comparisons}
        requests={requests}
        chosen={place.country}
        onChoose={(country) => {
          onPlaceChange({ ...place, country });
        }}
        onPick={onPick}
        onOpenVersion={onOpenVersion}
        words={words}
      />
    ) : section === 'requests' ? (
      <div className="flex flex-col gap-4">
        <p className="text-small text-muted">{t('knowledge.lists.lead.requests')}</p>
        <RequestSections
          versions={versions}
          columns={requestColumns}
          words={words}
          onOpenVersion={onOpenVersion}
        />
      </div>
    ) : (
      <div className="flex flex-col gap-4">
        {statusTabs}
        {statusPanel(gridColumns)}
      </div>
    );
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <Tabs
          label={t('knowledge.lists.sections')}
          tabs={[
            { value: 'rules' as const, label: t('knowledge.lists.rules') },
            {
              value: 'requests' as const,
              label: t('knowledge.lists.requestsTitle'),
              count: waiting,
            },
          ]}
          value={section}
          onChange={(next) => {
            onPlaceChange({ ...place, section: next });
          }}
          idBase={sectionsId}
          className="min-w-0 flex-1"
        />
        {tools}
      </div>
      <div {...tabPanelProps(sectionsId, section)} className="flex flex-col gap-4 outline-none">
        {body}
      </div>
    </div>
  );
}

/**
 * The countries down the side, each with its counts; the picked one's proposed, active and previous
 * versions side by side, or its requests.
 */
function CountryLayout({
  section,
  versions,
  comparisons,
  requests,
  chosen,
  onChoose,
  onPick,
  onOpenVersion,
  words,
}: {
  readonly section: Section;
  readonly versions: readonly KnowledgeVersion[];
  readonly comparisons: readonly KnowledgeComparisonVersion[];
  readonly requests: readonly CountryRequest[];
  readonly chosen: string | null;
  readonly onChoose: (country: string) => void;
  readonly onPick: (picked: Picked) => void;
  readonly onOpenVersion: (routeId: string, number: number) => void;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const tallies = countryTallies(versions, requests, words.country);
  const comparisonTally: CountryTally = {
    country: comparisonsKey,
    waiting: 0,
    ...countsByTab(listsByTab([], comparisons)),
  };
  const entries = comparisons.length > 0 ? [...tallies, comparisonTally] : tallies;
  const shown =
    entries.find(({ country }) => country === chosen) ??
    entries.find(({ proposed }) => proposed > 0) ??
    entries[0];
  const nameOf = (key: string) =>
    key === comparisonsKey ? t('knowledge.review.comparisons') : words.country(key);
  const countriesLabel = t('knowledge.lists.countries');
  const country =
    shown === undefined || shown.country === comparisonsKey ? undefined : shown.country;
  return (
    <div className="grid items-start gap-6 md:grid-cols-[17rem_minmax(0,1fr)]">
      <nav aria-label={countriesLabel} className={`overflow-hidden ${cardClass}`}>
        <ul className="flex flex-col divide-y divide-line">
          {entries.map((entry) => (
            <li key={entry.country}>
              <button
                type="button"
                aria-pressed={entry.country === shown?.country}
                aria-label={t('knowledge.lists.tally', {
                  ...entry,
                  country: nameOf(entry.country),
                })}
                className={`flex min-h-touch w-full items-center gap-3 px-3 py-2 text-left hover:bg-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${entry.country === shown?.country ? 'bg-soft font-medium' : ''}`}
                onClick={() => {
                  onChoose(entry.country);
                }}
              >
                {entry.country !== comparisonsKey && <CountryFlag code={entry.country} />}
                <span className="min-w-0 flex-1 break-words">{nameOf(entry.country)}</span>
                <TallyMarks tally={entry} />
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-col gap-4">
        {shown !== undefined && (section === 'rules' || country !== undefined) && (
          <h3 className="flex items-center gap-3 font-display text-lead">
            {country !== undefined && <CountryFlag code={country} />}
            {nameOf(shown.country)}
          </h3>
        )}
        {shown === undefined && section === 'rules' ? (
          <p className="text-muted">{t('knowledge.lists.empty.proposed')}</p>
        ) : section === 'requests' || shown === undefined ? (
          <RequestSections
            key={country}
            versions={versions}
            {...(country === undefined ? {} : { country })}
            columns={countryRequestColumns}
            words={words}
            onOpenVersion={onOpenVersion}
          />
        ) : (
          <ShownCountry
            country={shown.country}
            versions={versions}
            comparisons={comparisons}
            onPick={onPick}
            words={words}
          />
        )}
      </div>
    </div>
  );
}

const tallyTones: Record<VersionTab | 'waiting', string> = {
  proposed: 'bg-warn-bg text-warn-ink',
  active: 'bg-ok-bg text-ok-ink',
  previous: 'bg-soft text-muted',
  waiting: 'bg-danger-bg text-danger-ink',
};

/** A country's counts as small tinted numbers; the button's name says them in words. */
function TallyMarks({ tally }: { readonly tally: CountryTally }) {
  return (
    <span aria-hidden="true" className="flex shrink-0 gap-1">
      {tallyKeys
        .filter((key) => tally[key] > 0)
        .map((key) => (
          <span
            key={key}
            className={`min-w-6 rounded-full px-1.5 text-center text-caption font-medium tabular-nums ${tallyTones[key]}`}
          >
            {tally[key]}
          </span>
        ))}
    </span>
  );
}

/** The picked country's three lists side by side, each a card that folds. */
function ShownCountry({
  country,
  versions,
  comparisons,
  onPick,
  words,
}: {
  readonly country: string;
  readonly versions: readonly KnowledgeVersion[];
  readonly comparisons: readonly KnowledgeComparisonVersion[];
  readonly onPick: (picked: Picked) => void;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const isComparisons = country === comparisonsKey;
  const lists = isComparisons
    ? listsByTab([], comparisons)
    : listsByTab(
        versions.filter((version) => version.country === country),
        [],
      );
  return (
    <div className="grid items-start gap-x-4 lg:grid-cols-3">
      {versionTabs.map((key) => {
        const list = lists[key];
        const count = countOf(list);
        const foldId = `country:${key}`;
        return (
          <Fold
            key={key}
            id={foldId}
            fallback
            title={t(`knowledge.lists.${key}`)}
            count={count}
            summary={
              isComparisons
                ? t('knowledge.review.versions', { n: count })
                : spanSummary(list.versions, key, words)
            }
            className={foldingCardClass}
          >
            {count === 0 ? (
              <p className="pb-4 text-small text-muted">{t(`knowledge.lists.empty.${key}`)}</p>
            ) : (
              <ol className={foldRowsClass}>
                {isComparisons ? (
                  <ComparisonRows
                    comparisons={list.comparisons}
                    tab={key}
                    onPick={onPick}
                    words={words}
                  />
                ) : (
                  <CountryRows
                    versions={list.versions}
                    tab={key}
                    foldId={foldId}
                    named
                    onPick={onPick}
                    words={words}
                  />
                )}
              </ol>
            )}
          </Fold>
        );
      })}
    </div>
  );
}

function PickedVersion({ routeId, number }: { readonly routeId: string; readonly number: number }) {
  const view = useQuery(versionViewQuery(routeId, number));
  if (view.isError || view.data === undefined) return <ViewState query={view} />;
  return <VersionPanel view={view.data} />;
}

function PickedComparison({
  comparisonId,
  number,
}: {
  readonly comparisonId: string;
  readonly number: number;
}) {
  const view = useQuery(comparisonViewQuery(comparisonId, number));
  if (view.isError || view.data === undefined) return <ViewState query={view} />;
  return <ComparisonPanel view={view.data} />;
}

/** A view still loading, or one that failed with a way to try again. */
function ViewState({
  query,
}: {
  readonly query: { readonly isError: boolean; readonly refetch: () => unknown };
}) {
  const { t } = useTranslation();
  if (!query.isError) return null;
  return (
    <div className="flex flex-col gap-3">
      <p>{t('knowledge.loadFailure')}</p>
      <Button onClick={() => void query.refetch()}>{t('knowledge.retry')}</Button>
    </div>
  );
}
