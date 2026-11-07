import {
  type ActivateCheckedResponse,
  type KnowledgeVersion,
  routes,
} from '@arca/api-contract/client';
import { Button, Icon } from '@arca/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { api } from '../api.js';
import { commonFailure, reach, type CommonFailure } from '../requests.js';
import { card } from './review-parts.js';
import type { KnowledgeWords } from './words.js';

const keyOf = ({ routeId, number }: { routeId: string; number: number }) =>
  `${routeId}/${String(number)}`;

type BatchState =
  | { readonly step: 'idle' }
  | { readonly step: 'confirming'; readonly shown: readonly KnowledgeVersion[] }
  | { readonly step: 'waiting'; readonly shown: readonly KnowledgeVersion[] }
  | {
      readonly step: 'done';
      readonly shown: readonly KnowledgeVersion[];
      readonly result: ActivateCheckedResponse;
    }
  | { readonly step: 'failed'; readonly failure: CommonFailure };

/**
 * One tap for every proposed route version the independent check found clean (ADR-0027). The
 * confirmation lists them; the server activates only those still checked and names the rest. The
 * versions confirmed are kept, so a refetch while the admin reads never changes what is sent.
 */
export function CheckedBatch({
  versions,
  words,
}: {
  readonly versions: readonly KnowledgeVersion[];
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const titleId = useId();
  const skippedId = useId();
  const queryClient = useQueryClient();
  const [state, setState] = useState<BatchState>({ step: 'idle' });
  const statusRef = useRef<HTMLParagraphElement>(null);
  const checked = versions.filter(({ state: s, check }) => s === 'proposed' && check === 'checked');

  if (checked.length === 0 && (state.step === 'idle' || state.step === 'confirming')) return null;

  const name = (version: { routeId: string; number: number }, shown: readonly KnowledgeVersion[]) =>
    t('knowledge.versionTitle', {
      title: shown.find((each) => keyOf(each) === keyOf(version))?.title ?? version.routeId,
      number: version.number,
    });

  const send = (shown: readonly KnowledgeVersion[]) => {
    setState({ step: 'waiting', shown });
    reach(
      api.call(routes.activateCheckedVersions, {
        versions: shown.map(({ routeId, number, hash }) => ({ routeId, number, hash })),
      }),
    )
      .then(async (result) => {
        setState({ step: 'done', shown, result });
        await queryClient.invalidateQueries({ queryKey: ['knowledge'] });
      })
      .catch((error: unknown) => {
        setState({ step: 'failed', failure: commonFailure(error) });
      })
      .finally(() => {
        statusRef.current?.focus();
      });
  };

  const message =
    state.step === 'waiting'
      ? t('knowledge.checkedBatch.waiting')
      : state.step === 'done'
        ? t('knowledge.checkedBatch.activated', { n: state.result.activated.length })
        : state.step === 'failed'
          ? t('knowledge.failure', { reason: state.failure })
          : '';

  return (
    <section aria-labelledby={titleId} className={card}>
      <h3 id={titleId} className="flex items-center gap-2 font-medium">
        <Icon name="ai" size={18} />
        {t('knowledge.checkedBatch.title')}
      </h3>
      {state.step === 'confirming' ? (
        <div className="flex flex-col items-start gap-3">
          <p>{t('knowledge.checkedBatch.lead')}</p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {state.shown.map((version) => (
              <li key={keyOf(version)}>
                {name(version, state.shown)} · {words.country(version.country)}
              </li>
            ))}
          </ul>
          <p className="text-small text-muted">{t('knowledge.checkedBatch.oneByOne')}</p>
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => {
                send(state.shown);
              }}
            >
              {t('knowledge.checkedBatch.confirm')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setState({ step: 'idle' });
              }}
            >
              {t('knowledge.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          {checked.length > 0 && (
            <>
              <p>{t('knowledge.checkedBatch.intro', { n: checked.length })}</p>
              <Button
                disabled={state.step === 'waiting'}
                onClick={() => {
                  setState({ step: 'confirming', shown: checked });
                }}
              >
                {t('knowledge.checkedBatch.action', { n: checked.length })}
              </Button>
            </>
          )}
        </div>
      )}
      <p ref={statusRef} role="status" tabIndex={-1}>
        {message}
      </p>
      {state.step === 'done' && state.result.activated.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {state.result.activated.map((version) => (
            <li key={keyOf(version)}>{name(version, state.shown)}</li>
          ))}
        </ul>
      )}
      {state.step === 'done' && state.result.skipped.length > 0 && (
        <section aria-labelledby={skippedId} className="flex flex-col gap-1">
          <h4 id={skippedId} className="font-medium">
            {t('knowledge.checkedBatch.skippedTitle')}
          </h4>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {state.result.skipped.map((version) => (
              <li key={keyOf(version)}>
                {t('knowledge.checkedBatch.skipped', {
                  version: name(version, state.shown),
                  reason: version.reason,
                })}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
