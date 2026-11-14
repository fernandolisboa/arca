import { ApiError, VersionViewQuery } from '@arca/api-contract/client';
import { Button } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { sessionQuery, versionViewQuery } from '../api.js';
import { textLinkClass } from '../forms/text-link.js';
import type { CheckedVersion } from '../knowledge/check-run.js';
import { CheckRunBody } from '../knowledge/check-run-body.js';
import { useKnowledgeWords } from '../knowledge/words.js';
import { Page } from '../page.js';

/** The version the address names: public rule identities only, never personal data. */
function checkedVersionSearch(search: Record<string, unknown>): CheckedVersion {
  const parsed = VersionViewQuery.safeParse(search);
  return parsed.success ? parsed.data : { routeId: '', number: 0 };
}

export const Route = createFileRoute('/knowledge_/check')({
  validateSearch: checkedVersionSearch,
  component: CheckRunScreen,
});

/**
 * One route version's check as it runs (ADR-0027, "On demand, with progress"): its steps, read
 * again every second and a half while it runs, then the stored report. The admin may leave; the
 * check carries on and the version's button leads back here.
 */
function CheckRunScreen() {
  const words = useKnowledgeWords();
  const { t } = words;
  const version = Route.useSearch();
  const session = useQuery(sessionQuery);
  const admin = session.data?.admin === true;
  const known = version.routeId !== '' && version.number > 0;
  const view = useQuery({
    ...versionViewQuery(version.routeId, version.number),
    enabled: admin && known,
  });
  const title = t('knowledge.checkRun.title');
  const back = (
    <Link to="/knowledge" className={`${textLinkClass} self-start`}>
      {t('knowledge.checkRun.back')}
    </Link>
  );
  if (session.isError || (session.isSuccess && !admin)) {
    return (
      <Page title={title}>
        <p>{t(session.isError ? 'knowledge.signIn' : 'knowledge.notAdmin')}</p>
      </Page>
    );
  }
  if (!known || (view.error instanceof ApiError && view.error.status === 404)) {
    return (
      <Page title={title}>
        {back}
        <p>{t('knowledge.checkRun.unknownVersion')}</p>
      </Page>
    );
  }
  if (view.isError) {
    return (
      <Page title={title}>
        {back}
        <p>{t('knowledge.loadFailure')}</p>
        <Button onClick={() => void view.refetch()}>{t('knowledge.retry')}</Button>
      </Page>
    );
  }
  if (view.data === undefined) return <Page title={title} />;
  return (
    <Page
      title={title}
      lead={t('knowledge.versionTitle', { title: view.data.title, number: view.data.number })}
    >
      {back}
      <CheckRunBody view={view.data} words={words} />
    </Page>
  );
}
