import { type ApiError, type UpdateProgress, routes } from '@arca/api-contract/client';
import { Button, Icon, StatusChip, type StatusTone } from '@arca/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, use, useEffect, useId, useRef, useState } from 'react';
import { api, updateRequestQuery } from '../api.js';
import { commonFailure, reach } from '../requests.js';
import { OpenRouteVersionContext } from './corrections.js';
import { card } from './review-parts.js';
import type { KnowledgeWords } from './words.js';

const startCodes = ['update_live', 'update_off', 'update_not_started', 'not_found'] as const;
const isStartCode = (code: string): code is (typeof startCodes)[number] =>
  (startCodes as readonly string[]).includes(code);
const startFailure = (error: unknown) =>
  commonFailure(error, ({ code }: ApiError) => (isStartCode(code) ? code : undefined));

export interface UpdateRequestState {
  readonly progress: UpdateProgress | null;
  /** The progress could not be read, as for anyone not an admin: nothing is offered. */
  readonly unavailable: boolean;
  readonly confirming: boolean;
  readonly starting: boolean;
  readonly failure: ReturnType<typeof startFailure> | undefined;
  readonly ask: () => void;
  readonly cancel: () => void;
  readonly confirm: () => void;
}

/**
 * An admin's update request for one route (ADR-0031): asked, confirmed with its cost in view,
 * then followed stage by stage while the workflow runs.
 */
export function useUpdateRequest(routeId: string): UpdateRequestState {
  const queryClient = useQueryClient();
  const newest = useQuery(updateRequestQuery(routeId));
  const [confirming, setConfirming] = useState(false);
  const start = useMutation({
    mutationFn: () => reach(api.call(routes.startUpdateRequest, { routeId })),
    networkMode: 'always',
    onSuccess: async () => {
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: ['knowledge', 'update-request', routeId] });
    },
  });
  return {
    progress: newest.data?.request ?? null,
    unavailable: newest.isError,
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

/** The button that asks for an update, or, while one runs, says so. */
export function UpdateRequestButton({
  state,
  words,
}: {
  readonly state: UpdateRequestState;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  if (state.unavailable) return null;
  const running = state.progress?.state === 'running';
  return (
    <Button
      variant="secondary"
      disabled={running || state.confirming || state.starting}
      onClick={state.ask}
    >
      {running ? (
        <span aria-hidden="true" className="size-2 animate-stage-pulse rounded-full bg-primary" />
      ) : (
        <Icon name="ai" size={18} />
      )}
      {running ? t('knowledge.update.running') : t('knowledge.update.button')}
    </Button>
  );
}

const stateTones: Record<UpdateProgress['state'], StatusTone> = {
  running: 'unknown',
  finished: 'ok',
  failed: 'warn',
  stalled: 'warn',
};

const stageTones: Record<UpdateProgress['stages'][number]['state'], StatusTone> = {
  done: 'ok',
  failed: 'warn',
  running: 'unknown',
  skipped: 'unknown',
  pending: 'unknown',
};

/** What every request's progress shows, an update of a route or a new route alike. */
export type RequestProgressView = Omit<UpdateProgress, 'routeId' | 'baseNumber'>;

function RequestCost({
  progress,
  words,
}: {
  readonly progress: RequestProgressView;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const { cost, state } = progress;
  if (cost === null) return null;
  switch (cost.kind) {
    case 'priced':
      return <p>{t('knowledge.update.spent', { state, cost: words.usd(cost.microUsd) })}</p>;
    case 'unknown':
      return <p>{t('knowledge.update.costUnknown')}</p>;
    case 'scripted':
      return <p>{t('knowledge.update.costScripted')}</p>;
  }
}

export function RequestStateChip({
  progress,
  words,
}: {
  readonly progress: RequestProgressView;
  readonly words: KnowledgeWords;
}) {
  return (
    <StatusChip
      tone={stateTones[progress.state]}
      label={words.t('knowledge.update.chip', { state: progress.state })}
    />
  );
}

/**
 * A request's state, its stages side by side on a wide screen, the three lists once it finished
 * with `proposed` saying where the proposal waits, and what it cost.
 */
export function RequestProgressBody({
  progress,
  proposed,
  words,
}: {
  readonly progress: RequestProgressView;
  readonly proposed: ReactNode;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  return (
    <>
      <p role="status">
        {t('knowledge.update.state', { state: progress.state })}
        {progress.failure !== null &&
          ` ${t('knowledge.update.failure', { failure: progress.failure })}`}
      </p>
      <ol
        aria-label={t('knowledge.update.stages')}
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {progress.stages.map(({ stage, state: stageState }) => (
          <li
            key={stage}
            aria-current={stageState === 'running' ? 'step' : undefined}
            className={`flex min-w-0 flex-col gap-1 ${stageState === 'pending' || stageState === 'skipped' ? 'text-muted' : ''}`}
          >
            <span className="font-medium">{t('knowledge.update.stage', { stage })}</span>
            <span>
              <StatusChip
                tone={stageTones[stageState]}
                label={t('knowledge.update.stageState', {
                  // After a failure or a stall, a stage that never ran was not "not needed".
                  state:
                    stageState === 'skipped' && progress.state !== 'finished'
                      ? 'not_run'
                      : stageState,
                })}
              />
            </span>
          </li>
        ))}
      </ol>
      {progress.lists !== null && (
        <div className="flex flex-col gap-2">
          <h5 className="font-medium">{t('knowledge.update.lists')}</h5>
          <dl className="grid gap-3 sm:grid-cols-3">
            {Object.entries(progress.lists).map(([list, count]) => (
              <div key={list} className="flex flex-col">
                <dt className="text-small text-muted">{t('knowledge.update.list', { list })}</dt>
                <dd className="font-display text-title">{count}</dd>
              </div>
            ))}
          </dl>
          {proposed}
        </div>
      )}
      <RequestCost progress={progress} words={words} />
    </>
  );
}

/** Where the finished request's proposal waits for review, with a way there. */
function ProposedVersion({
  number,
  words,
}: {
  readonly number: number;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const open = use(OpenRouteVersionContext);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-small text-muted">{t('knowledge.update.review', { number })}</p>
      {open !== undefined && (
        <Button
          variant="secondary"
          onClick={() => {
            open(number);
          }}
        >
          {t('knowledge.update.open', { number })}
        </Button>
      )}
    </div>
  );
}

/**
 * The confirmation, then the newest request's progress: its stages side by side on a wide screen,
 * the three lists once it finished, and what it cost.
 */
export function UpdateRequestCard({
  state,
  words,
}: {
  readonly state: UpdateRequestState;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const titleId = useId();
  const confirmId = useId();
  const confirmRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (state.confirming) confirmRef.current?.focus();
  }, [state.confirming]);
  const { progress } = state;

  return (
    <>
      {state.confirming && (
        <section
          aria-labelledby={confirmId}
          className={`${card} animate-row-land items-start gap-3`}
        >
          <h4 id={confirmId} ref={confirmRef} tabIndex={-1} className="font-medium">
            {t('knowledge.update.confirmTitle')}
          </h4>
          <p>{t('knowledge.update.confirmLead')}</p>
          <p className="font-medium">{t('knowledge.update.cost')}</p>
          <div className="flex flex-wrap gap-3">
            <Button disabled={state.starting} onClick={state.confirm}>
              {t('knowledge.update.confirm')}
            </Button>
            <Button variant="secondary" disabled={state.starting} onClick={state.cancel}>
              {t('knowledge.cancel')}
            </Button>
          </div>
          <p role="status">
            {state.starting
              ? t('knowledge.update.starting')
              : state.failure === undefined
                ? ''
                : t('knowledge.update.startFailure', { reason: state.failure })}
          </p>
        </section>
      )}
      {progress !== null && !state.unavailable && (
        <section aria-labelledby={titleId} className={`${card} gap-4`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h4 id={titleId} className="font-medium">
                {t('knowledge.update.title')}
              </h4>
              <p className="text-small text-muted">
                {t('knowledge.update.requestedAt', {
                  date: new Intl.DateTimeFormat(words.language, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(new Date(progress.requestedAt)),
                  number: progress.baseNumber,
                })}
              </p>
            </div>
            <RequestStateChip progress={progress} words={words} />
          </div>
          <RequestProgressBody
            progress={progress}
            proposed={
              progress.proposedNumber !== null && (
                <ProposedVersion number={progress.proposedNumber} words={words} />
              )
            }
            words={words}
          />
        </section>
      )}
    </>
  );
}
