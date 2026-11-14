import { type ApiError, type CheckProgress, routes } from '@arca/api-contract/client';
import { Button, Icon, StatusChip, type StatusTone, buttonClass } from '@arca/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';
import { api, checkProgressQuery, versionCheckQuery } from '../api.js';
import { commonFailure, reach } from '../requests.js';
import {
  type CheckRunStep,
  type CheckRunStepStatus,
  checkRunStepStatuses,
  checkRunSteps,
  pagesSettled,
} from './check-run-steps.js';
import { card } from './review-parts.js';
import type { KnowledgeWords } from './words.js';

/** A route version by its public identity, as the progress screen's address names it. */
export interface CheckedVersion {
  readonly routeId: string;
  readonly number: number;
}

type StartFailure = ReturnType<typeof startFailure>;
const startCodes = ['check_off', 'check_not_started'] as const;
const isStartCode = (code: string): code is (typeof startCodes)[number] =>
  (startCodes as readonly string[]).includes(code);
const startFailure = (error: unknown) =>
  commonFailure(error, ({ code }: ApiError) => (isStartCode(code) ? code : undefined));

export interface CheckRunState {
  readonly version: CheckedVersion;
  /** Whether this environment runs the check at all; the button is offered only where it does. */
  readonly offered: boolean;
  /** Whether a check of the version is running now. */
  readonly running: boolean;
  /** What the version's newest check whose report did not fail cost, in millionths of a dollar, when priced. */
  readonly lastCostMicroUsd: number | null;
  readonly confirming: boolean;
  readonly starting: boolean;
  readonly failure: StartFailure | undefined;
  readonly ask: () => void;
  readonly cancel: () => void;
  readonly confirm: () => void;
}

/**
 * An admin's own check of one route version (ADR-0027, "On demand, with progress"): asked, then
 * confirmed with its cost in view, then started. The server answers a running check in place of
 * a second one, so `onStarted` runs either way and the admin lands on the one to watch.
 */
export function useCheckRun(version: CheckedVersion, onStarted?: () => void): CheckRunState {
  const { routeId, number } = version;
  const queryClient = useQueryClient();
  const check = useQuery(versionCheckQuery(routeId, number));
  const progress = useQuery(checkProgressQuery(routeId, number));
  const finished = progress.data?.progress?.state === 'finished';
  // A forced check replaces a current report, so the report is read again once the run ends.
  useEffect(() => {
    if (finished) void queryClient.invalidateQueries({ queryKey: ['knowledge', 'check'] });
  }, [finished, queryClient]);
  const [confirming, setConfirming] = useState(false);
  const start = useMutation({
    mutationFn: () => reach(api.call(routes.startVersionCheck, { routeId, number })),
    networkMode: 'always',
    onSuccess: async () => {
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: ['knowledge'] });
      onStarted?.();
    },
  });
  return {
    version,
    offered: check.data?.enabled === true,
    running: progress.data?.progress?.state === 'running',
    lastCostMicroUsd: progress.data?.lastCostMicroUsd ?? null,
    confirming,
    starting: start.isPending,
    failure: start.isError ? startFailure(start.error) : undefined,
    ask: () => {
      start.reset();
      setConfirming(true);
    },
    cancel: () => {
      setConfirming(false);
    },
    confirm: () => {
      start.mutate();
    },
  };
}

/**
 * The button that asks for a check, or, while one runs, the link to watch it. `label` names the
 * action where the default would mislead, as "again" does after a check ended.
 */
export function CheckRunButton({
  state,
  words,
  label,
}: {
  readonly state: CheckRunState;
  readonly words: KnowledgeWords;
  readonly label?: string;
}) {
  const { t } = words;
  if (!state.offered) return null;
  if (state.running) {
    return (
      <Link to="/knowledge/check" search={state.version} className={buttonClass('secondary')}>
        <span aria-hidden="true" className="size-2 animate-stage-pulse rounded-full bg-primary" />
        {t('knowledge.checkRun.running')}
      </Link>
    );
  }
  return (
    <Button variant="secondary" disabled={state.confirming || state.starting} onClick={state.ask}>
      <Icon name="ai" size={18} />
      {label ?? t('knowledge.checkRun.button')}
    </Button>
  );
}

/** The confirmation with what a check costs, and what became of the request to start. */
export function CheckRunConfirm({
  state,
  words,
}: {
  readonly state: CheckRunState;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (state.confirming) titleRef.current?.focus();
  }, [state.confirming]);

  if (!state.confirming) return null;
  return (
    <section aria-labelledby={titleId} className={`${card} animate-row-land items-start gap-3`}>
      <h4 id={titleId} ref={titleRef} tabIndex={-1} className="font-medium">
        {t('knowledge.checkRun.confirmTitle')}
      </h4>
      <p>{t('knowledge.checkRun.confirmLead')}</p>
      <p className="font-medium">
        {state.lastCostMicroUsd === null
          ? t('knowledge.checkRun.cost')
          : t('knowledge.checkRun.lastCost', { cost: words.usd(state.lastCostMicroUsd) })}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button disabled={state.starting} onClick={state.confirm}>
          {t('knowledge.checkRun.confirm')}
        </Button>
        <Button variant="secondary" disabled={state.starting} onClick={state.cancel}>
          {t('knowledge.cancel')}
        </Button>
      </div>
      <p role="status">
        {state.starting
          ? t('knowledge.checkRun.starting')
          : state.failure === undefined
            ? ''
            : t('knowledge.checkRun.startFailure', { reason: state.failure })}
      </p>
    </section>
  );
}

/** What a check spent: so far while it runs, in all once it ends; nothing before a model call. */
export function CheckRunCost({
  progress,
  words,
}: {
  readonly progress: CheckProgress;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const { cost, state } = progress;
  if (cost === null) return null;
  switch (cost.kind) {
    case 'priced':
      return <p>{t('knowledge.checkRun.spent', { state, cost: words.usd(cost.microUsd) })}</p>;
    case 'unknown':
      return <p>{t('knowledge.checkRun.costUnknown')}</p>;
    case 'scripted':
      return <p>{t('knowledge.checkRun.costScripted')}</p>;
  }
}

const stepTones: Record<CheckRunStepStatus, StatusTone> = {
  done: 'ok',
  current: 'warn',
  stopped: 'warn',
  skipped: 'unknown',
  pending: 'unknown',
};

function StepMarker({ status }: { readonly status: CheckRunStepStatus }) {
  if (status === 'done') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ok-bg text-ok-ink">
        <Icon name="check" size={14} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line"
    >
      {status === 'current' && (
        <span className="size-2.5 animate-stage-pulse rounded-full bg-primary" />
      )}
      {status === 'stopped' && <span className="size-2.5 rounded-full bg-warn-ink" />}
    </span>
  );
}

/**
 * A check's steps two by two on a wide screen, each with where it is now: the pages and items
 * themselves are listed beside the step's detail, not under it.
 */
export function CheckRunSteps({
  progress,
  words,
}: {
  readonly progress: CheckProgress;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const statuses = checkRunStepStatuses(progress);
  const done = pagesSettled(progress);
  const details: Record<CheckRunStep, string | null> = {
    read:
      progress.pageCount === null
        ? null
        : t('knowledge.checkRun.readDetail', { done, total: progress.pageCount }),
    locate:
      progress.locatedPages === null
        ? null
        : t('knowledge.checkRun.locateDetail', { n: progress.locatedPages }),
    compare:
      progress.itemCount === null
        ? null
        : t('knowledge.checkRun.compareDetail', { n: progress.itemCount }),
    report: null,
  };
  return (
    <ol
      aria-label={t('knowledge.checkRun.steps')}
      className="grid content-start gap-4 sm:grid-cols-2"
    >
      {checkRunSteps.map((step) => {
        const status = statuses[step];
        return (
          <li
            key={step}
            aria-current={status === 'current' ? 'step' : undefined}
            className={`flex min-w-0 items-start gap-3 transition-colors duration-(--arca-duration-base) ease-out ${status === 'pending' || status === 'skipped' ? 'text-muted' : ''}`}
          >
            <StepMarker status={status} />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="font-medium">{t('knowledge.checkRun.step', { step })}</span>
              <span className="flex flex-wrap items-center gap-2 text-small">
                <StatusChip
                  tone={stepTones[status]}
                  label={t('knowledge.checkRun.stepStatus', { status })}
                />
                {details[step] !== null && status !== 'pending' && (
                  <span className="text-muted">{details[step]}</span>
                )}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const pageTone = (outcome: CheckProgress['pages'][number]['outcome']): StatusTone =>
  outcome === 'read' ? 'ok' : outcome === 'reading' ? 'unknown' : 'warn';

/**
 * The cited pages, each landing as its read begins and settling on its outcome. Everything from
 * the progress is plain text, so no URL becomes a link.
 */
export function CheckRunPages({
  progress,
  words,
}: {
  readonly progress: CheckProgress;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  if (progress.pages.length === 0) {
    return <p className="text-small text-muted">{t('knowledge.checkRun.noPages')}</p>;
  }
  return (
    <ul className="flex flex-col">
      {progress.pages.map(({ url, outcome, status: httpStatus }) => (
        <li
          key={url}
          className="flex animate-row-land flex-col gap-1 border-t border-line py-2 text-small first:border-t-0"
        >
          <span className="font-mono break-all">{url}</span>
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip
              tone={pageTone(outcome)}
              label={t('knowledge.checkRun.pageOutcome', { outcome })}
            />
            {outcome !== 'read' && outcome !== 'reading' && (
              <span className="text-muted">
                {outcome === 'http_status' && httpStatus === null
                  ? t('knowledge.checkRun.httpStatus')
                  : t('knowledge.check.outcome', { outcome, status: String(httpStatus ?? '') })}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
