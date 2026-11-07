import type { DestinationComparison } from '@arca/api-contract/client';
import { applyEdit, type Edit, type Preferences } from './edits.js';

/**
 * The comparison's edits on their way to the API: one write at a time, the edits made while it
 * is in flight going together in the next one, each built on the latest answer.
 */
export interface SaveQueue {
  /** The answer of the latest write, newer than the read until the cache catches up. */
  readonly answer: DestinationComparison | undefined;
  /** The edits the API has not confirmed yet, oldest first. */
  readonly pending: readonly Edit[];
  /** How many of `pending` the write in flight carries; 0 while none is in flight. */
  readonly sending: number;
}

export const emptyQueue: SaveQueue = { answer: undefined, pending: [], sending: 0 };

/** The comparison the screen shows: the latest answer, else the read. */
export const shownComparison = (queue: SaveQueue, read: DestinationComparison | undefined) =>
  queue.answer ?? read;

/** The person's choices with every unconfirmed edit on top, for the controls to show at once. */
export const editedPreferences = (queue: SaveQueue, base: DestinationComparison): Preferences =>
  queue.pending.reduce(applyEdit, base.preferences);

export const queued = (queue: SaveQueue, edit: Edit): SaveQueue => ({
  ...queue,
  pending: [...queue.pending, edit],
});

/** The next write, if one may start: every pending edit, on top of the latest preferences. */
export function nextWrite(
  queue: SaveQueue,
  read: DestinationComparison,
): { readonly queue: SaveQueue; readonly body: Preferences } | undefined {
  if (queue.sending > 0 || queue.pending.length === 0) return undefined;
  return {
    queue: { ...queue, sending: queue.pending.length },
    body: editedPreferences(queue, queue.answer ?? read),
  };
}

/** A write answered: its edits are confirmed and the ones made meanwhile wait for the next. */
export const answered = (queue: SaveQueue, answer: DestinationComparison): SaveQueue => ({
  answer,
  pending: queue.pending.slice(queue.sending),
  sending: 0,
});
