import {
  ApiError,
  type KnowledgeComparisonVersion,
  type KnowledgeVersion,
} from '@arca/api-contract/client';
import { Button, Icon, StatusChip, cardClass } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { type ReactNode, useId, useState } from 'react';
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
import { ReportsSection } from '../knowledge/reports-section.js';
import { type CountryGroup, reviewNeed, reviewOrder } from '../knowledge/review-order.js';
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
  useStartChecks(versions.isSuccess);
  const title = t('knowledge.title');
  if (session.isError) {
    return (
      <Page title={title}>
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
      <Page title={title}>
        <p>{t('knowledge.notAdmin')}</p>
      </Page>
    );
  }
  if (versions.isError) {
    return (
      <Page title={title}>
        <p>{t('knowledge.loadFailure')}</p>
        <Button onClick={() => void versions.refetch()}>{t('knowledge.retry')}</Button>
      </Page>
    );
  }
  if (versions.data === undefined) return <Page title={title} />;
  if (picked !== null) {
    return (
      <Page title={title} wide>
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
          <PickedVersion key={pickedKey(picked)} routeId={picked.routeId} number={picked.number} />
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
  const groups = reviewOrder(
    all.filter(({ state }) => state === 'proposed'),
    words.country,
  );
  const proposedComparisons = listed.filter(
    ({ picked, state }) => picked.subject === 'comparison' && state === 'proposed',
  );
  const others = listed.filter(({ state }) => state !== 'proposed');
  return (
    <Page title={title} lead={t('knowledge.lead')} wide>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <CheckedBatch versions={all} words={words} />
          <ProposedVersions
            groups={groups}
            comparisons={proposedComparisons}
            onPick={setPicked}
            words={words}
          />
          {others.length > 0 && (
            <VersionList title={t('knowledge.others')} versions={others} onPick={setPicked} />
          )}
        </div>
        <ReportsSection versions={all} words={words} />
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

const needTone = { differs: 'danger', ready: 'ok', unread: 'warn' } as const;

/**
 * The proposed versions by country, in the order to review them (reviewOrder), each with what it
 * asks of the admin and how its check's points came out; the comparisons last.
 */
function ProposedVersions({
  groups,
  comparisons,
  onPick,
  words,
}: {
  readonly groups: readonly CountryGroup<KnowledgeVersion>[];
  readonly comparisons: readonly Listed[];
  readonly onPick: (picked: Picked) => void;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const title = t('knowledge.proposed');
  const first = groups[0]?.versions[0];
  const startHere = first !== undefined && ['differs', 'ready'].includes(reviewNeed(first));
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">{title}</h3>
        {groups.length > 0 && (
          <p className="text-small text-muted">{t('knowledge.review.order')}</p>
        )}
      </div>
      {groups.length === 0 && comparisons.length === 0 && (
        <p className="text-muted">{t('knowledge.noneProposed')}</p>
      )}
      {groups.map(({ country, versions }) => (
        <ProposedGroup
          key={country}
          title={words.country(country)}
          count={versions.length}
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
                    {startHere && version === first && (
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
          words={words}
        >
          {comparisons.map((version) => (
            <li key={pickedKey(version.picked)}>
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
          ))}
        </ProposedGroup>
      )}
    </section>
  );
}

/** One country's proposed versions, under its name, as rows in one card. */
function ProposedGroup({
  title,
  count,
  words,
  children,
}: {
  readonly title: string;
  readonly count: number;
  readonly words: KnowledgeWords;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={`overflow-hidden ${cardClass}`}>
      <div className="flex items-baseline justify-between gap-3 border-b border-line bg-soft px-4 py-3">
        <h4 id={headingId} className="font-medium">
          {title}
        </h4>
        <span className="text-small text-muted">
          {words.t('knowledge.review.versions', { n: count })}
        </span>
      </div>
      <ol className="flex flex-col divide-y divide-line">{children}</ol>
    </section>
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
