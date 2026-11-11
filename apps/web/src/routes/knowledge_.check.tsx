import { ApiError, type VersionView, VersionViewQuery } from '@arca/api-contract/client';
import { Button } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useId } from 'react';
import { checkProgressQuery, sessionQuery, versionViewQuery } from '../api.js';
import { textLinkClass } from '../forms/text-link.js';
import {
  type CheckedVersion,
  CheckRunButton,
  CheckRunConfirm,
  CheckRunSteps,
  useCheckRun,
} from '../knowledge/check-run.js';
import { CheckReport } from '../knowledge/checks.js';
import { type KnowledgeWords, useKnowledgeWords } from '../knowledge/words.js';
import { Page } from '../page.js';
import { useDateFormat } from '../use-date-format.js';

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

function CheckRunBody({
  view,
  words,
}: {
  readonly view: VersionView;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const version = { routeId: view.routeId, number: view.number };
  const progress = useQuery(checkProgressQuery(version.routeId, version.number));
  const checkRun = useCheckRun(version, () => void progress.refetch());
  const dateFormat = useDateFormat();
  const resultId = useId();

  if (progress.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p>{t('knowledge.checkRun.loadFailure')}</p>
        <Button onClick={() => void progress.refetch()}>{t('knowledge.retry')}</Button>
      </div>
    );
  }
  if (progress.data === undefined) return null;
  const run = progress.data;
  const again = (
    <>
      <CheckRunButton
        state={checkRun}
        words={words}
        {...(run === null ? {} : { label: t('knowledge.checkRun.again') })}
      />
      <CheckRunConfirm state={checkRun} words={words} />
      {!checkRun.confirming && checkRun.failure !== undefined && (
        <p role="status">{t('knowledge.checkRun.startFailure', { reason: checkRun.failure })}</p>
      )}
    </>
  );
  if (run === null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p>{t('knowledge.checkRun.none')}</p>
        {again}
      </div>
    );
  }
  const done = run.pages.filter(({ outcome }) => outcome !== 'reading').length;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-small text-muted">
        {t('knowledge.checkRun.startedAt', { date: dateFormat.format(new Date(run.startedAt)) })}
      </p>
      {/* Polite, so a screen reader hears each new stage without losing its place. */}
      <div aria-live="polite" className="flex flex-col gap-1">
        <p className="font-medium">{t('knowledge.checkRun.state', { state: run.state })}</p>
        {run.state === 'running' && (
          <p>
            {t('knowledge.checkRun.now', {
              stage: run.stage,
              done,
              total: run.pageCount ?? 0,
            })}
          </p>
        )}
        {run.failure === 'check_unknown_version' && <p>{t('knowledge.checkRun.unknownVersion')}</p>}
      </div>
      {run.state === 'running' && (
        <p className="text-small text-muted">{t('knowledge.checkRun.leave')}</p>
      )}
      <CheckRunSteps progress={run} words={words} />
      {run.state === 'finished' && (
        <section aria-labelledby={resultId} className="flex flex-col gap-3">
          <h3 id={resultId} className="font-medium">
            {t('knowledge.checkRun.result')}
          </h3>
          <CheckReport view={view} words={words} startsOpen level={4} />
        </section>
      )}
      {run.state !== 'running' && <div className="flex flex-col items-start gap-3">{again}</div>}
    </div>
  );
}
