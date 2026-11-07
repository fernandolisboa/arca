import {
  ApiError,
  type KnowledgeComparisonVersion,
  type KnowledgeVersion,
} from '@arca/api-contract/client';
import { Button, StatusChip } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  comparisonViewQuery,
  knowledgeVersionsQuery,
  sessionQuery,
  versionViewQuery,
} from '../api.js';
import { textLinkClass } from '../forms/text-link.js';
import { ComparisonPanel } from '../knowledge/comparison-panel.js';
import { ReportsSection } from '../knowledge/reports-section.js';
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
  const approver = session.data?.approver === true;
  const versions = useQuery({ ...knowledgeVersionsQuery, enabled: approver });
  const [picked, setPicked] = useState<Picked | null>(null);
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
    (session.isSuccess && !approver) ||
    (versions.error instanceof ApiError && versions.error.status === 403)
  ) {
    return (
      <Page title={title}>
        <p>{t('knowledge.notApprover')}</p>
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
  const proposed = listed.filter(({ state }) => state === 'proposed');
  const others = listed.filter(({ state }) => state !== 'proposed');
  return (
    <Page title={title} lead={t('knowledge.lead')} wide>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <VersionList title={t('knowledge.proposed')} versions={proposed} onPick={setPicked} />
          {proposed.length === 0 && <p className="text-muted">{t('knowledge.noneProposed')}</p>}
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
              <StatusChip
                tone={stateTone(version.state)}
                label={words.t('knowledge.state', { state: version.state })}
              />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PickedVersion({ routeId, number }: { readonly routeId: string; readonly number: number }) {
  const view = useQuery(versionViewQuery(routeId, number));
  if (view.data === undefined) return <ViewState query={view} />;
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
  if (view.data === undefined) return <ViewState query={view} />;
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
