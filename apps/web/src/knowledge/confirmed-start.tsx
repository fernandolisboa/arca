import { Button, Icon } from '@arca/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { KnowledgeWords } from './words.js';

/** The words of one admin action that asks for a confirmation before it starts. */
export interface ConfirmedStartWords<Result> {
  readonly button: string;
  readonly lead: string;
  readonly confirm: string;
  readonly starting: string;
  readonly started: (result: Result) => string;
  readonly failed: (error: unknown) => string;
}

/**
 * A button that asks, shows what starting costs, then starts and says what became of it; the
 * knowledge lists are read again once it started.
 */
export function ConfirmedStart<Result>({
  offered = true,
  start,
  text,
  words,
}: {
  /** Whether to offer the button; what became of a start stays shown either way. */
  readonly offered?: boolean;
  readonly start: () => Promise<Result>;
  readonly text: ConfirmedStartWords<Result>;
  readonly words: KnowledgeWords;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const mutation = useMutation({
    mutationFn: start,
    networkMode: 'always',
    onSuccess: async () => {
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });
  return (
    <div className="flex flex-col items-start gap-3">
      {offered && !confirming && (
        <Button
          variant="secondary"
          disabled={mutation.isPending}
          onClick={() => {
            mutation.reset();
            setConfirming(true);
          }}
        >
          <Icon name="ai" size={18} />
          {text.button}
        </Button>
      )}
      {confirming && (
        <>
          <p>{text.lead}</p>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={mutation.isPending}
              onClick={() => {
                mutation.mutate();
              }}
            >
              {text.confirm}
            </Button>
            <Button
              variant="secondary"
              disabled={mutation.isPending}
              onClick={() => {
                setConfirming(false);
              }}
            >
              {words.t('knowledge.cancel')}
            </Button>
          </div>
        </>
      )}
      <p role="status">
        {mutation.isPending
          ? text.starting
          : mutation.isSuccess
            ? text.started(mutation.data)
            : mutation.isError
              ? text.failed(mutation.error)
              : ''}
      </p>
    </div>
  );
}
