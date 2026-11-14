import {
  ApiError,
  type KnowledgeComparisonVersion,
  type KnowledgeVersion,
} from '@arca/api-contract/client';
import { Button, Disclosure, Icon, StatusChip, cardClass } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  comparisonViewQuery,
  knowledgeVersionsQuery,
  sessionQuery,
  versionViewQuery,
} from '../api.js';
import { textLinkClass } from '../forms/text-link.js';
import { CheckedBatch } from '../knowledge/checked-batch.js';
import { CheckChip, useStartChecks } from '../knowledge/checks.js';
import { ComparisonPanel } from '../knowledge/comparison-panel.js';
import { OpenRouteVersionContext } from '../knowledge/corrections.js';
import { QueuedChecks } from '../knowledge/queued-checks.js';
import { ReportsSection } from '../knowledge/reports-section.js';
import { RouteRequestsSection } from '../knowledge/route-requests.js';
import { ReviewFilters, needTone } from '../knowledge/review-filters.js';
import {
  type CountryGroup,
  type ReviewFilter,
  actionable,
  filtering,
  needCounts,
  noFilter,
  passes,
  reviewNeed,
  reviewNeeds,
  reviewOrder,
} from '../knowledge/review-order.js';
import { tallyWords } from '../knowledge/step-nav.js';
import { stateTone } from '../knowledge/state-tone.js';
import { VersionPanel } from '../knowledge/version-panel.js';
import { type KnowledgeWords, useKnowledgeWords } from '../knowledge/words.js';
import { Page } from '../page.js';

export const Route = createFileRoute('/knowledge')({ component: Knowledge });

/** The version picked for review: a route version or a comparison version (ADR-0026). */
type Picked =
  | { readonly subject: 'route'; readonly routeId: string; readonly number: number }
  | { readonly subject: 'comparison'; readonly comparisonId: string; readonly number: number };

/** Either kind of version as one list item. */
interface Listed {
  readonly picked: Picked;
  readonly title: string;
  readonly meta: string;
  readonly state: KnowledgeVersion['state'];
  /** A route version's independent check; comparisons are never checked. */
  readonly check?: KnowledgeVersion['check'];
}

const pickedKey = (picked: Picked) =>
  picked.subject === 'route'
    ? `route:${picked.routeId}:${String(picked.number)}`
    : `comparison:${picked.comparisonId}:${String(picked.number)}`;

/** The activation screen (spec 0007, R7): proposed versions first, the newest first. */
function Knowledge() {
  const words = useKnowledgeWords();
  const { t } = words;
  const session = useQuery(sessionQuery);
  const admin = session.data?.admin === true;
  const versions = useQuery({ ...knowledgeVersionsQuery, enabled: admin });
  const [picked, setPicked] = useState<Picked | null>(null);
  const openRouteVersion = useCallback((number: number) => {
    setPicked((current) => (current?.subject === 'route' ? { ...current, number } : current));
  }, []);
  const [picks, setPicks] = useState<ReviewFilter>(noFilter);
  const [openCountries, setOpenCountries] = useState<ReadonlySet<string>>(() => new Set());
  useStartChecks(versions.isSuccess);
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
  const all = versions.data.versions;
  const listed = [
    ...versions.data.comparisons.map((version) => comparisonItem(version, words)),
    ...all.map((version) => routeItem(version, words)),
  ];
  const allProposed = all.filter(({ state }) => state === 'proposed');
  const proposed = allProposed.filter((version) => !version.superseded);
  const superseded = allProposed.filter((version) => version.superseded);
  const ordered = reviewOrder(proposed, words.country);
  const first = ordered[0]?.versions[0];
  // A country whose last proposed version was decided drops out of the filter.
  const filter =
    picks.country === null || ordered.some(({ country }) => country === picks.country)
      ? picks
      : { ...picks, country: null };
  const filtered = proposed.length > 0 && filtering(filter);
  const proposedComparisons = filtered
    ? []
    : listed.filter(({ picked, state }) => picked.subject === 'comparison' && state === 'proposed');
  const others = listed.filter(({ state }) => state !== 'proposed');
  return (
    <Page title={title} lead={t('knowledge.lead')}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <CheckedBatch versions={proposed} words={words} />
          <ProposedVersions
            groups={reviewOrder(
              proposed.filter((version) => passes(filter, version)),
              words.country,
            )}
            startHere={first !== undefined && actionable(reviewNeed(first)) ? first : undefined}
            comparisons={proposedComparisons}
            filters={
              proposed.length > 0 && (
                <>
                  <QueuedChecks
                    queued={
                      proposed.filter(({ check }) => check === 'stale' || check === 'none').length
                    }
                    words={words}
                  />
                  <ReviewFilters
                    countries={ordered
                      .map(({ country }) => country)
                      .toSorted((left, right) =>
                        words.country(left).localeCompare(words.country(right)),
                      )}
                    counts={needCounts(proposed, filter)}
                    filter={filter}
                    onChange={(next) => {
                      setPicks(next);
                      const { country } = next;
                      if (country !== null) setOpenCountries((was) => new Set(was).add(country));
                    }}
                    words={words}
                  />
                </>
              )
            }
            filtered={filtered}
            onClearFilter={() => {
              setPicks(noFilter);
            }}
            openCountries={openCountries}
            onToggleCountry={(country, open) => {
              setOpenCountries((was) => {
                const next = new Set(was);
                if (open) next.add(country);
                else next.delete(country);
                return next;
              });
            }}
            onPick={setPicked}
            words={words}
          />
          {superseded.length > 0 && (
            <SupersededVersions
              versions={superseded.map((version) => routeItem(version, words))}
              onPick={setPicked}
              words={words}
            />
          )}
          {others.length > 0 && (
            <VersionList title={t('knowledge.others')} versions={others} onPick={setPicked} />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-8">
          <ReportsSection versions={all} words={words} />
          <RouteRequestsSection
            words={words}
            onOpenVersion={(routeId, number) => {
              setPicked({ subject: 'route', routeId, number });
            }}
          />
        </div>
      </div>
    </Page>
  );
}

function routeItem(version: KnowledgeVersion, words: KnowledgeWords): Listed {
  return {
    picked: { subject: 'route', routeId: version.routeId, number: version.number },
    title: version.title,
    meta: words.t('knowledge.versionMeta', {
      country: words.country(version.country),
      date: words.date(version.effectiveFrom),
    }),
    state: version.state,
    check: version.check,
  };
}

function comparisonItem(version: KnowledgeComparisonVersion, words: KnowledgeWords): Listed {
  return {
    picked: { subject: 'comparison', comparisonId: version.comparisonId, number: version.number },
    title: version.title,
    meta: words.t('knowledge.comparison.meta'),
    state: version.state,
  };
}

function VersionList({
  title,
  versions,
  onPick,
}: {
  readonly title: string;
  readonly versions: readonly Listed[];
  readonly onPick: (picked: Picked) => void;
}) {
  const words = useKnowledgeWords();
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="font-medium">{title}</h3>
      <ul className="grid gap-3 md:grid-cols-2">
        {versions.map((version) => (
          <li key={pickedKey(version.picked)}>
            <button
              type="button"
              className="flex h-full min-h-touch w-full flex-col items-start gap-1 rounded-control border border-line bg-surface p-4 text-left hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              onClick={() => {
                onPick(version.picked);
              }}
            >
              <span className="font-medium">
                {words.t('knowledge.versionTitle', {
                  title: version.title,
                  number: version.picked.number,
                })}
              </span>
              <span className="text-small text-muted">{version.meta}</span>
              <span className="flex flex-wrap gap-2">
                <StatusChip
                  tone={stateTone(version.state)}
                  label={words.t('knowledge.state', { state: version.state })}
                />
                {version.check !== undefined && <CheckChip status={version.check} words={words} />}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const rowButton =
  'flex min-h-touch w-full items-start gap-3 px-4 py-3 text-left hover:bg-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary';

/**
 * The proposed versions by country, in the order to review them (reviewOrder), each with what it
 * asks of the admin and how its check's points came out; the comparisons last. Each country folds
 * behind its name, which keeps a tally of its needs, and the screen keeps which are open.
 */
function ProposedVersions({
  groups,
  startHere,
  comparisons,
  filters,
  filtered,
  onClearFilter,
  openCountries,
  onToggleCountry,
  onPick,
  words,
}: {
  readonly groups: readonly CountryGroup<KnowledgeVersion>[];
  /** The version to review first, when the admin can act on it now. */
  readonly startHere: KnowledgeVersion | undefined;
  readonly comparisons: readonly Listed[];
  readonly filters: ReactNode;
  readonly filtered: boolean;
  readonly onClearFilter: () => void;
  readonly openCountries: ReadonlySet<string>;
  readonly onToggleCountry: (country: string, open: boolean) => void;
  readonly onPick: (picked: Picked) => void;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const title = t('knowledge.proposed');
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">{title}</h3>
        {groups.length > 0 && (
          <p className="text-small text-muted">{t('knowledge.review.order')}</p>
        )}
        {groups.length > 0 && <NeedHints words={words} />}
      </div>
      {filters}
      {groups.length === 0 && comparisons.length === 0 && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-muted">
            {t(filtered ? 'knowledge.review.filter.empty' : 'knowledge.noneProposed')}
          </p>
          {filtered && (
            <button type="button" className={textLinkClass} onClick={onClearFilter}>
              {t('knowledge.review.filter.clear')}
            </button>
          )}
        </div>
      )}
      {groups.map(({ country, versions }) => (
        <ProposedGroup
          key={country}
          title={words.country(country)}
          count={versions.length}
          tally={
            <>
              {startHere?.country === country && (
                <span className="text-caption font-medium text-accent">
                  {t('knowledge.review.start')}
                </span>
              )}
              <NeedTally versions={versions} words={words} />
            </>
          }
          open={openCountries.has(country)}
          onOpenChange={(open) => {
            onToggleCountry(country, open);
          }}
          words={words}
        >
          {versions.map((version, position) => {
            const need = reviewNeed(version);
            const { points } = version;
            return (
              <li key={`${version.routeId}:${String(version.number)}`}>
                <button
                  type="button"
                  className={rowButton}
                  onClick={() => {
                    onPick({ subject: 'route', routeId: version.routeId, number: version.number });
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="grid size-7 shrink-0 place-items-center rounded-full bg-soft text-small font-medium tabular-nums"
                  >
                    {position + 1}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-medium">
                      {t('knowledge.versionTitle', {
                        title: version.title,
                        number: version.number,
                      })}
                    </span>
                    {version === startHere && (
                      <span className="text-caption font-medium text-accent">
                        {t('knowledge.review.start')}
                      </span>
                    )}
                    <span className="text-small text-muted">
                      {t('knowledge.versionMeta', {
                        country: words.country(version.country),
                        date: words.date(version.effectiveFrom),
                      })}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {need === 'unchecked' ? (
                        <CheckChip status={version.check} words={words} />
                      ) : (
                        <StatusChip
                          tone={needTone[need]}
                          label={t('knowledge.review.need', { need })}
                        />
                      )}
                      {points !== null && (
                        <span className="text-small text-muted">{tallyWords(points, words)}</span>
                      )}
                    </span>
                  </span>
                  <span aria-hidden="true" className="self-center text-muted">
                    <Icon name="chevron" size={16} />
                  </span>
                </button>
              </li>
            );
          })}
        </ProposedGroup>
      ))}
      {comparisons.length > 0 && (
        <ProposedGroup
          title={t('knowledge.review.comparisons')}
          count={comparisons.length}
          open={openCountries.has(comparisonsGroup)}
          onOpenChange={(open) => {
            onToggleCountry(comparisonsGroup, open);
          }}
          words={words}
        >
          {comparisons.map((version) => (
            <ListedRow key={pickedKey(version.picked)} version={version} onPick={onPick} />
          ))}
        </ProposedGroup>
      )}
    </section>
  );
}

/** A version as a plain row: its title and when it applies from, with no check. */
function ListedRow({
  version,
  onPick,
}: {
  readonly version: Listed;
  readonly onPick: (picked: Picked) => void;
}) {
  const { t } = useKnowledgeWords();
  return (
    <li>
      <button
        type="button"
        className={rowButton}
        onClick={() => {
          onPick(version.picked);
        }}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-medium">
            {t('knowledge.versionTitle', {
              title: version.title,
              number: version.picked.number,
            })}
          </span>
          <span className="text-small text-muted">{version.meta}</span>
        </span>
        <span aria-hidden="true" className="self-center text-muted">
          <Icon name="chevron" size={16} />
        </span>
      </button>
    </li>
  );
}

/**
 * Proposed versions no date from today on would use, folded apart: a correction or a later version
 * took their place, so they need no decision and are not checked while that holds.
 */
function SupersededVersions({
  versions,
  onPick,
  words,
}: {
  readonly versions: readonly Listed[];
  readonly onPick: (picked: Picked) => void;
  readonly words: KnowledgeWords;
}) {
  const [open, setOpen] = useState(false);
  return (
    <ProposedGroup
      title={words.t('knowledge.superseded.title')}
      count={versions.length}
      tally={<span className="text-small text-muted">{words.t('knowledge.superseded.lead')}</span>}
      open={open}
      onOpenChange={setOpen}
      words={words}
    >
      {versions.map((version) => (
        <ListedRow key={pickedKey(version.picked)} version={version} onPick={onPick} />
      ))}
    </ProposedGroup>
  );
}

/** The open-state key of the comparisons' card, which no country code can take. */
const comparisonsGroup = 'comparisons';

/** What the admin can do about each need, folded until asked. */
function NeedHints({ words }: { readonly words: KnowledgeWords }) {
  const { t } = words;
  return (
    <Disclosure
      title={t('knowledge.review.hints.title')}
      level={4}
      defaultOpen={false}
      className="flex flex-col"
    >
      <dl className="flex flex-col gap-3 pb-2">
        {reviewNeeds.map((need) => (
          <div key={need} className="flex flex-col items-start gap-1">
            <dt>
              <StatusChip tone={needTone[need]} label={t('knowledge.review.need', { need })} />
            </dt>
            <dd className="text-small">{t(`knowledge.review.hints.${need}`)}</dd>
          </div>
        ))}
      </dl>
    </Disclosure>
  );
}

/** How many of a country's versions have each need, so a folded card still says what waits. */
function NeedTally({
  versions,
  words,
}: {
  readonly versions: readonly KnowledgeVersion[];
  readonly words: KnowledgeWords;
}) {
  const counts = needCounts(versions, noFilter);
  return (
    <>
      {reviewNeeds
        .filter((need) => counts[need] > 0)
        .map((need) => (
          <StatusChip
            key={need}
            tone={needTone[need]}
            label={words.t(`knowledge.review.needCount.${need}`, { n: counts[need] })}
          />
        ))}
    </>
  );
}

/** One country's proposed versions, folded behind its name, as rows in one card. */
function ProposedGroup({
  title,
  count,
  tally,
  open,
  onOpenChange,
  words,
  children,
}: {
  readonly title: string;
  readonly count: number;
  readonly tally?: ReactNode;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly words: KnowledgeWords;
  readonly children: ReactNode;
}) {
  return (
    <Disclosure
      title={title}
      level={4}
      open={open}
      onOpenChange={onOpenChange}
      aside={
        <span className="flex basis-full flex-wrap items-center gap-2 pb-3">
          {tally}
          <span className="text-small text-muted">
            {words.t('knowledge.review.versions', { n: count })}
          </span>
        </span>
      }
      className={`overflow-hidden px-4 ${cardClass}`}
    >
      <ol className="-mx-4 flex flex-col divide-y divide-line border-t border-line">{children}</ol>
    </Disclosure>
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
