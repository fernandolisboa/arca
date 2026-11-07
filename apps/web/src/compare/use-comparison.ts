import { routes, type DestinationComparison } from '@arca/api-contract/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, comparisonQuery, sessionQuery } from '../api.js';
import { reach } from '../requests.js';
import type { Edit, Preferences } from './edits.js';
import { editedPreferences, shownComparison } from './save-queue.js';
import { comparisonSaver, idleSaver, type SaveFailure } from './saver.js';

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
 * as the person goes (`saver.ts`). Every score and the order come back from the API; a failed
 * write puts back what was saved.
 */
export function useComparison(enabled: boolean) {
  const queryClient = useQueryClient();
  const read = useQuery({ ...comparisonQuery, enabled });
  const [state, setState] = useState(idleSaver);
  const [saver] = useState(() =>
    comparisonSaver({
      write: (body) => reach(api.call(routes.writeComparisonPreferences, body)),
      account: () => queryClient.getQueryData(sessionQuery.queryKey)?.accountId,
      show: setState,
      saved: (answer) => {
        queryClient.setQueryData(comparisonQuery.queryKey, answer);
      },
      refetch: () => {
        void queryClient.invalidateQueries({ queryKey: comparisonQuery.queryKey });
      },
    }),
  );
  const comparison = shownComparison(state.queue, read.data);
  if (comparison === undefined) return { read, editor: undefined };
  const editor: ComparisonEditor = {
    comparison,
    preferences: editedPreferences(state.queue, comparison),
    saving: state.queue.pending.length > 0,
    failure: state.failure,
    change: (edit) => {
      saver.change(edit, comparison);
    },
  };
  return { read, editor };
}
