import { routes } from '@arca/api-contract/client';
import { Button, Icon } from '@arca/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.js';
import { reach } from '../requests.js';
import { startFailure } from './check-run.js';
import type { KnowledgeWords } from './words.js';

/**
 * An admin's check of every version in the queue at once (ADR-0027): asked, confirmed with what
 * each check costs, then started by the server, which picks the versions, so the screen sends no
 * identities.
 */
export function QueuedChecks({
  queued,
  words,
}: {
  /** How many proposed versions the list shows in the queue. */
  readonly queued: number;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const start = useMutation({
    mutationFn: () => reach(api.call(routes.startQueuedChecks)),
    networkMode: 'always',
    onSuccess: async () => {
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });
  const failure = start.isError ? startFailure(start.error) : undefined;
  if (queued === 0 && !start.isSuccess) return null;
  return (
    <div className="flex flex-col items-start gap-3">
      {queued > 0 && !confirming && (
        <Button
          variant="secondary"
          disabled={start.isPending}
          onClick={() => {
            start.reset();
            setConfirming(true);
          }}
        >
          <Icon name="ai" size={18} />
          {t('knowledge.queuedChecks.button')}
        </Button>
      )}
      {confirming && (
        <>
          <p>{t('knowledge.queuedChecks.confirmLead', { n: queued })}</p>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={start.isPending}
              onClick={() => {
                start.mutate();
              }}
            >
              {t('knowledge.queuedChecks.confirm')}
            </Button>
            <Button
              variant="secondary"
              disabled={start.isPending}
              onClick={() => {
                setConfirming(false);
              }}
            >
              {t('knowledge.cancel')}
            </Button>
          </div>
        </>
      )}
      <p role="status">
        {start.isPending
          ? t('knowledge.queuedChecks.starting')
          : start.isSuccess
            ? t('knowledge.queuedChecks.started', { n: start.data.started })
            : failure === undefined
              ? ''
              : t('knowledge.checkRun.startFailure', { reason: failure })}
      </p>
    </div>
  );
}
