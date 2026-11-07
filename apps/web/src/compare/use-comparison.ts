import { ApiError, routes, type DestinationComparison } from '@arca/api-contract/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, comparisonQuery, sessionQuery } from '../api.js';
import { reach, UnreachableError } from '../requests.js';
import type { Edit, Preferences } from './edits.js';
import {
  answered,
  editedPreferences,
  emptyQueue,
  nextWrite,
  queued,
  shownComparison,
  type SaveQueue,
} from './save-queue.js';

/** Why a change was not saved; `changed` is a criterion another tab deleted. */
export type SaveFailure = 'limited' | 'changed' | 'unreachable' | 'other';

function saveFailure(error: unknown): SaveFailure {
  if (error instanceof UnreachableError) return 'unreachable';
  if (!(error instanceof ApiError)) return 'other';
  if (error.status === 429) return 'limited';
  return error.status === 409 ? 'changed' : 'other';
}

export interface ComparisonEditor {
  /** The ranking as the API last computed it. */
  readonly comparison: DestinationComparison;
  /** The person's choices with their unsaved edits, for the controls to show at once. */
  readonly preferences: Preferences;
  readonly saving: boolean;
  readonly failure: SaveFailure | undefined;
  readonly change: (edit: Edit) => void;
}

/**
 * The comparison and the way to change it: each edit shows in the controls at once and is saved
 * as the person goes (`save-queue.ts`). Every score and the order come back from the API; a
 * failed write puts back what was saved.
 */
export function useComparison(enabled: boolean) {
  const queryClient = useQueryClient();
  const read = useQuery({ ...comparisonQuery, enabled });
  // The queue lives in a ref so a write's callback sees the edits made after it started; the
  // screen renders from the state copy, which takes an answer and its leftover edits together.
  const queueRef = useRef<SaveQueue>(emptyQueue);
  const [queue, setQueue] = useState<SaveQueue>(emptyQueue);
  const [failure, setFailure] = useState<SaveFailure>();
  const comparison = shownComparison(queue, read.data);

  const account = () => queryClient.getQueryData(sessionQuery.queryKey)?.accountId;

  function update(next: SaveQueue) {
    queueRef.current = next;
    setQueue(next);
  }

  function sendNext(read: DestinationComparison) {
    const write = nextWrite(queueRef.current, read);
    if (write === undefined) return;
    update(write.queue);
    const writer = account();
    reach(api.call(routes.writeComparisonPreferences, write.body)).then(
      (answer) => {
        // After a sign-out, or a sign-in as someone else, the answer and any queued edits are the
        // previous account's: they never reach the cache or the next account's preferences.
        if (account() !== writer) {
          update(emptyQueue);
          return;
        }
        update(answered(queueRef.current, answer));
        queryClient.setQueryData(comparisonQuery.queryKey, answer);
        sendNext(answer);
      },
      (error: unknown) => {
        const reason = saveFailure(error);
        update(emptyQueue);
        setFailure(reason);
        // The cache still holds the last saved answer; reading again would spend the read limit.
        if (reason !== 'limited') {
          void queryClient.invalidateQueries({ queryKey: comparisonQuery.queryKey });
        }
      },
    );
  }

  if (comparison === undefined) return { read, editor: undefined };
  const change = (edit: Edit) => {
    update(queued(queueRef.current, edit));
    setFailure(undefined);
    sendNext(comparison);
  };
  const editor: ComparisonEditor = {
    comparison,
    preferences: editedPreferences(queue, comparison),
    saving: queue.pending.length > 0,
    failure,
    change,
  };
  return { read, editor };
}
