import { ApiError, type KnowledgeVersion } from '@arca/api-contract/client';
import { Button } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { knowledgeVersionsQuery, sessionQuery, versionViewQuery } from '../api.js';
import { textLinkClass } from '../forms/text-link.js';
import { ReportsSection } from '../knowledge/reports-section.js';
import { VersionPanel } from '../knowledge/version-panel.js';
import { useKnowledgeWords } from '../knowledge/words.js';
import { Page } from '../page.js';

export const Route = createFileRoute('/knowledge')({ component: Knowledge });

interface Picked {
  readonly routeId: string;
  readonly number: number;
}

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
      <Page title={title}>
        <button
          type="button"
          className={textLinkClass}
          onClick={() => {
            setPicked(null);
          }}
        >
          {t('knowledge.back')}
        </button>
        <PickedVersion picked={picked} />
      </Page>
    );
  }
  const all = versions.data.versions;
  const proposed = all.filter(({ state }) => state === 'proposed');
  const others = all.filter(({ state }) => state !== 'proposed');
  return (
    <Page title={title} lead={t('knowledge.lead')}>
      <VersionList title={t('knowledge.proposed')} versions={proposed} onPick={setPicked} />
      {proposed.length === 0 && <p className="text-muted">{t('knowledge.noneProposed')}</p>}
      {others.length > 0 && (
        <VersionList title={t('knowledge.others')} versions={others} onPick={setPicked} />
      )}
      <ReportsSection versions={all} words={words} />
    </Page>
  );
}

function VersionList({
  title,
  versions,
  onPick,
}: {
  readonly title: string;
  readonly versions: readonly KnowledgeVersion[];
  readonly onPick: (picked: Picked) => void;
}) {
  const words = useKnowledgeWords();
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="font-medium">{title}</h3>
      <ul className="flex flex-col gap-2">
        {versions.map((version) => (
          <li key={`${version.routeId}:${String(version.number)}`}>
            <button
              type="button"
              className="flex min-h-touch w-full flex-col items-start rounded-control px-2 py-1 text-left hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              onClick={() => {
                onPick({ routeId: version.routeId, number: version.number });
              }}
            >
              <span className="font-medium">
                {words.t('knowledge.versionTitle', {
                  title: version.title,
                  number: version.number,
                })}
              </span>
              <span className="text-small text-muted">
                {[
                  words.t('knowledge.versionMeta', {
                    country: words.country(version.country),
                    date: words.date(version.effectiveFrom),
                  }),
                  words.t('knowledge.state', { state: version.state }),
                ].join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PickedVersion({ picked }: { readonly picked: Picked }) {
  const { t } = useTranslation();
  const view = useQuery(versionViewQuery(picked.routeId, picked.number));
  if (view.isError) {
    return (
      <div className="flex flex-col gap-3">
        <p>{t('knowledge.loadFailure')}</p>
        <Button onClick={() => void view.refetch()}>{t('knowledge.retry')}</Button>
      </div>
    );
  }
  if (view.data === undefined) return null;
  return <VersionPanel view={view.data} />;
}
