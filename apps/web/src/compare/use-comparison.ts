import { ApiError, routes, type DestinationComparison } from '@arca/api-contract/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, comparisonQuery } from '../api.js';
import { reach, UnreachableError } from '../requests.js';
import { applyEdit, type Edit, type Preferences } from './edits.js';

/** Why a change was not saved; `changed` is a criterion another tab deleted. */
export type SaveFailure = 'limited' | 'changed' | 'unreachable' | 'other';

interface Saved {
  /** The answer of the latest write, newer than the read until the cache catches up. */
  readonly answer: DestinationComparison | undefined;
  /** The edits the API has not confirmed yet, oldest first. */
  readonly pending: readonly Edit[];
}

interface Queue extends Saved {
  readonly sending: boolean;
}

const idle: Queue = { answer: undefined, pending: [], sending: false };

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
 * as the person goes, one write at a time, the edits made meanwhile going together in the next
 * one. Every score and the order come back from the API; a failed write puts back what was saved.
 */
export function useComparison(enabled: boolean) {
  const queryClient = useQueryClient();
  const read = useQuery({ ...comparisonQuery, enabled });
  // The queue lives in a ref so a write's callback sees the edits made after it started; the
  // screen renders from `saved`, which takes the answer and its leftover edits in one update.
  const queueRef = useRef<Queue>(idle);
  const [saved, setSaved] = useState<Saved>(idle);
  const [failure, setFailure] = useState<SaveFailure>();
  const comparison = saved.answer ?? read.data;

  function sendNext(base: DestinationComparison) {
    const { pending, sending } = queueRef.current;
    if (sending || pending.length === 0) return;
    const count = pending.length;
    queueRef.current = { ...queueRef.current, sending: true };
    reach(
      api.call(routes.writeComparisonPreferences, pending.reduce(applyEdit, base.preferences)),
    ).then(
      (answer) => {
        queueRef.current = {
          answer,
          pending: queueRef.current.pending.slice(count),
          sending: false,
        };
        setSaved(queueRef.current);
        queryClient.setQueryData(comparisonQuery.queryKey, answer);
        sendNext(answer);
      },
      (error: unknown) => {
        queueRef.current = idle;
        setSaved(idle);
        setFailure(saveFailure(error));
        void queryClient.invalidateQueries({ queryKey: comparisonQuery.queryKey });
      },
    );
  }

  if (comparison === undefined) return { read, editor: undefined };
  const change = (edit: Edit) => {
    queueRef.current = { ...queueRef.current, pending: [...queueRef.current.pending, edit] };
    setSaved(queueRef.current);
    setFailure(undefined);
    sendNext(queueRef.current.answer ?? comparison);
  };
  const editor: ComparisonEditor = {
    comparison,
    preferences: saved.pending.reduce(applyEdit, comparison.preferences),
    saving: saved.pending.length > 0,
    failure,
    change,
  };
  return { read, editor };
}
