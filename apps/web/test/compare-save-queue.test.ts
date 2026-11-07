import type { DestinationComparison } from '@arca/api-contract/client';
import { describe, expect, it } from 'vitest';
import type { Edit } from '../src/compare/edits.js';
import {
  answered,
  editedPreferences,
  emptyQueue,
  nextWrite,
  queued,
  shownComparison,
} from '../src/compare/save-queue.js';

const comparison = (weights: Record<string, number>): DestinationComparison => ({
  version: { comparisonId: 'destinations', number: 1 },
  pendingNewer: false,
  criteria: [],
  countries: [],
  preferences: { weights, ratings: {}, ownCriteria: [], hidden: [] },
});

const read = comparison({});
const weigh = (criterion: string, weight: number): Edit => ({ kind: 'weight', criterion, weight });

describe('Comparison save queue', () => {
  it('sends nothing without an edit', () => {
    expect(nextWrite(emptyQueue, read)).toBeUndefined();
  });

  it('shows an edit at once and sends it on top of the read', () => {
    const edited = queued(emptyQueue, weigh('safety', 5));
    expect(editedPreferences(edited, read).weights).toEqual({ safety: 5 });
    const write = nextWrite(edited, read);
    expect(write?.body.weights).toEqual({ safety: 5 });
    expect(write?.queue.sending).toBe(1);
  });

  it('holds the edits made during a write and sends them together on top of its answer', () => {
    const first = nextWrite(queued(emptyQueue, weigh('safety', 5)), read);
    if (first === undefined) throw new Error('no write');
    let queue = queued(queued(first.queue, weigh('climate', 1)), weigh('taxes', 0));
    expect(nextWrite(queue, read)).toBeUndefined();
    const answer = comparison({ safety: 5 });
    queue = answered(queue, answer);
    expect(shownComparison(queue, read)).toBe(answer);
    expect(queue.pending).toHaveLength(2);
    expect(editedPreferences(queue, answer).weights).toEqual({ safety: 5, climate: 1, taxes: 0 });
    const second = nextWrite(queue, read);
    expect(second?.body.weights).toEqual({ safety: 5, climate: 1, taxes: 0 });
    expect(second?.queue.sending).toBe(2);
  });

  it('is idle once every edit is answered', () => {
    const write = nextWrite(queued(emptyQueue, weigh('safety', 5)), read);
    if (write === undefined) throw new Error('no write');
    const queue = answered(write.queue, comparison({ safety: 5 }));
    expect(queue.pending).toEqual([]);
    expect(nextWrite(queue, read)).toBeUndefined();
  });
});
