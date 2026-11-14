import type { VersionView } from '@arca/api-contract/client';
import { Button, cardClass } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { checkProgressQuery, versionCheckQuery } from '../api.js';
import { useDateFormat } from '../use-date-format.js';
import { CheckRunLive, CheckRunReport } from './check-run-layout.js';
import { pagesSettled } from './check-run-steps.js';
import {
  CheckRunButton,
  CheckRunConfirm,
  CheckRunCost,
  CheckRunSteps,
  useCheckRun,
} from './check-run.js';
import type { KnowledgeWords } from './words.js';

/**
 * A check's screen below its title: where the run is, its steps in one row, then what it read and
 * found, laid out side by side on a wide screen.
 */
export function CheckRunBody({
  view,
  words,
}: {
  readonly view: VersionView;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const version = { routeId: view.routeId, number: view.number };
  const progress = useQuery(checkProgressQuery(version.routeId, version.number));
  const checkRun = useCheckRun(version);
  const dateFormat = useDateFormat();
  const check = useQuery(versionCheckQuery(version.routeId, version.number));

  if (progress.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p>{t('knowledge.checkRun.loadFailure')}</p>
        <Button onClick={() => void progress.refetch()}>{t('knowledge.retry')}</Button>
      </div>
    );
  }
  if (progress.data === undefined) return null;
  const run = progress.data.progress;
  const button = (
    <CheckRunButton
      state={checkRun}
      words={words}
      {...(run === null ? {} : { label: t('knowledge.checkRun.again') })}
    />
  );
  const confirm = (
    <>
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
        {button}
        {confirm}
      </div>
    );
  }
  const done = pagesSettled(run);
  const report = check.data?.enabled === true ? check.data.report : null;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section
        className={`${cardClass} grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-8`}
      >
        <div className="flex min-w-0 flex-col items-start gap-3">
          {/* Polite, so a screen reader hears each new stage without losing its place. */}
          <div aria-live="polite" className="flex min-w-0 flex-col gap-1">
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
            {run.failure === 'check_unknown_version' && (
              <p>{t('knowledge.checkRun.unknownVersion')}</p>
            )}
            <p className="text-small text-muted">
              {t('knowledge.checkRun.startedAt', {
                date: dateFormat.format(new Date(run.startedAt)),
              })}
            </p>
            <CheckRunCost progress={run} words={words} />
            {run.state === 'running' && (
              <p className="text-small text-muted">{t('knowledge.checkRun.leave')}</p>
            )}
          </div>
          {run.state !== 'running' && button}
          {confirm}
        </div>
        {/* Once the run ended its steps are history, so a phone keeps the screen for the report. */}
        <div className={run.state === 'finished' ? 'max-sm:hidden' : undefined}>
          <CheckRunSteps progress={run} words={words} />
        </div>
      </section>
      {run.state === 'finished' && report !== null ? (
        <CheckRunReport report={report} progress={run} country={view.country} words={words} />
      ) : (
        <CheckRunLive progress={run} words={words} />
      )}
    </div>
  );
}
