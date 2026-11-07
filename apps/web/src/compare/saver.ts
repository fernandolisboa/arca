import { ApiError, type DestinationComparison } from '@arca/api-contract/client';
import { UnreachableError } from '../requests.js';
import type { Edit, Preferences } from './edits.js';
import { answered, emptyQueue, nextWrite, queued, type SaveQueue } from './save-queue.js';

/** Why a change was not saved; `changed` is a criterion another tab deleted. */
export type SaveFailure = 'limited' | 'changed' | 'unreachable' | 'other';

export function saveFailure(error: unknown): SaveFailure {
  if (error instanceof UnreachableError) return 'unreachable';
  if (!(error instanceof ApiError)) return 'other';
  if (error.status === 429) return 'limited';
  return error.status === 409 ? 'changed' : 'other';
}

export interface SaverState {
  readonly queue: SaveQueue;
  readonly failure: SaveFailure | undefined;
}

export const idleSaver: SaverState = { queue: emptyQueue, failure: undefined };

export interface SaverPorts {
  readonly write: (body: Preferences) => Promise<DestinationComparison>;
  /** Who is signed in now, so an answer for someone else is dropped. */
  readonly account: () => string | undefined;
  readonly show: (state: SaverState) => void;
  /** The API saved a write; its answer is the comparison everyone should read now. */
  readonly saved: (answer: DestinationComparison) => void;
  /** Reads the comparison again after a failed write. */
  readonly refetch: () => void;
}

/**
 * Sends the comparison's edits through the save queue: each answer starts the next write, a
 * failed write drops what was not saved, and an answer that arrives after a sign-out or a sign-in
 * as someone else is the previous account's, so it never reaches the cache or the next account.
 */
export function comparisonSaver(ports: SaverPorts) {
  let state = idleSaver;

  function update(next: SaverState) {
    state = next;
    ports.show(next);
  }

  function sendNext(base: DestinationComparison) {
    const write = nextWrite(state.queue, base);
    if (write === undefined) return;
    update({ ...state, queue: write.queue });
    const writer = ports.account();
    ports.write(write.body).then(
      (answer) => {
        if (ports.account() !== writer) {
          update(idleSaver);
          return;
        }
        update({ ...state, queue: answered(state.queue, answer) });
        ports.saved(answer);
        sendNext(answer);
      },
      (error: unknown) => {
        const failure = saveFailure(error);
        update({ queue: emptyQueue, failure });
        // The cache still holds the last saved answer; reading again would spend the read limit.
        if (failure !== 'limited') ports.refetch();
      },
    );
  }

  return {
    /** Queues an edit made on `base`, the comparison the screen shows, and sends it when it can. */
    change(edit: Edit, base: DestinationComparison) {
      update({ queue: queued(state.queue, edit), failure: undefined });
      sendNext(base);
    },
  };
}
