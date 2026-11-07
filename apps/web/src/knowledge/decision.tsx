import {
  routes,
  decideComparisonAction,
  decideVersionAction,
  type ComparisonVersionView,
  type VersionView,
} from '@arca/api-contract/client';
import { Button } from '@arca/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { passkeys } from '../platform.js';
import { commonFailure, reach, type CommonFailure } from '../requests.js';
import { stepUpFor } from '../step-up.js';
import type { KnowledgeWords } from './words.js';

type DecisionKind = 'activate' | 'reject';
type Failure = CommonFailure | 'rejected';

/** A route version decision after its own `knowledge_decision` step-up, bound to its hash. */
export async function decideVersion(kind: DecisionKind, view: VersionView): Promise<void> {
  const route = kind === 'activate' ? routes.activateVersion : routes.rejectVersion;
  const request = { routeId: view.routeId, number: view.number };
  const approved = await stepUpFor(
    passkeys,
    decideVersionAction(route.operationId, request, view.hash),
    'knowledge_decision',
  );
  await reach(approved.call(route, request));
}

/** A comparison version decision, with the comparison's own step-up actions (ADR-0026). */
export async function decideComparison(
  kind: DecisionKind,
  view: ComparisonVersionView,
): Promise<void> {
  const route = kind === 'activate' ? routes.activateComparison : routes.rejectComparison;
  const request = { comparisonId: view.comparisonId, number: view.number };
  const approved = await stepUpFor(
    passkeys,
    decideComparisonAction(route.operationId, request, view.hash),
    'knowledge_decision',
  );
  await reach(approved.call(route, request));
}

/**
 * The approver's decision on a route or comparison version: activate, reject, or neither once
 * rejected. `rejectWarning` says what a rejection would change today, when it changes something.
 */
export function Decision({
  state: versionState,
  decide,
  activateLead,
  rejectWarning,
  words,
}: {
  readonly state: VersionView['state'];
  readonly decide: (kind: DecisionKind) => Promise<void>;
  readonly activateLead: string;
  readonly rejectWarning: string | null;
  readonly words: KnowledgeWords;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<DecisionKind | null>(null);
  const [state, setState] = useState<
    'idle' | 'waiting' | { readonly done: DecisionKind } | { readonly failure: Failure }
  >('idle');
  const statusRef = useRef<HTMLParagraphElement>(null);

  const start = (kind: DecisionKind) => {
    setConfirming(null);
    setState('waiting');
    decide(kind)
      .then(async () => {
        setState({ done: kind });
        await queryClient.invalidateQueries({ queryKey: ['knowledge'] });
      })
      .catch((error: unknown) => {
        setState({
          failure: commonFailure(error, (apiError) =>
            apiError.code === 'already_rejected' ? 'rejected' : undefined,
          ),
        });
      })
      .finally(() => {
        statusRef.current?.focus();
      });
  };
  const message =
    state === 'waiting'
      ? words.t('knowledge.waiting')
      : typeof state === 'object'
        ? 'done' in state
          ? words.t('knowledge.decided', { kind: state.done })
          : words.t('knowledge.failure', { reason: state.failure })
        : '';
  const status = (
    <p ref={statusRef} role="status" tabIndex={-1}>
      {message}
    </p>
  );
  // A rejection is for good; the status stays, so the outcome and focus survive the refetch.
  if (versionState === 'rejected') {
    return (
      <div className="flex flex-col items-start gap-3">
        <p>{words.t('knowledge.rejectedNote')}</p>
        {status}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-3">
      {confirming === null ? (
        <div className="flex flex-wrap gap-3">
          {versionState === 'proposed' && (
            <Button
              disabled={state === 'waiting'}
              onClick={() => {
                setConfirming('activate');
              }}
            >
              {words.t('knowledge.activate')}
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={state === 'waiting'}
            onClick={() => {
              setConfirming('reject');
            }}
          >
            {words.t('knowledge.reject')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          {confirming === 'activate' ? (
            <p>{activateLead}</p>
          ) : (
            <>
              {rejectWarning !== null && <p className="text-danger-ink">{rejectWarning}</p>}
              <p>{words.t('knowledge.rejectLead')}</p>
            </>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => {
                start(confirming);
              }}
            >
              {words.t('knowledge.confirm')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(null);
              }}
            >
              {words.t('knowledge.cancel')}
            </Button>
          </div>
        </div>
      )}
      {status}
    </div>
  );
}
