import { ApiError, type DestinationComparison } from '@arca/api-contract/client';
import { describe, expect, it } from 'vitest';
import type { Edit, Preferences } from '../src/compare/edits.js';
import { comparisonSaver, saveFailure, type SaverState } from '../src/compare/saver.js';
import { UnreachableError } from '../src/requests.js';

const comparison = (weights: Record<string, number>): DestinationComparison => ({
  version: { comparisonId: 'destinations', number: 1 },
  pendingNewer: false,
  criteria: [],
  countries: [],
  preferences: { weights, ratings: {}, ownCriteria: [], hidden: [] },
});

const read = comparison({});
const weigh = (criterion: string, weight: number): Edit => ({ kind: 'weight', criterion, weight });

/** Lets the promise callbacks of an answered or failed write run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A saver whose writes wait until the test answers or fails them, recording what it reports. */
function harness() {
  const writes: {
    readonly body: Preferences;
    readonly answer: (answer: DestinationComparison) => void;
    readonly fail: (error: unknown) => void;
  }[] = [];
  const shown: SaverState[] = [];
  const saved: DestinationComparison[] = [];
  const signedIn = { account: 'account-a' as string | undefined, refetches: 0 };
  const saver = comparisonSaver({
    write: (body) =>
      new Promise((answer, fail) => {
        writes.push({ body, answer, fail });
      }),
    account: () => signedIn.account,
    show: (state) => shown.push(state),
    saved: (answer) => saved.push(answer),
    refetch: () => {
      signedIn.refetches += 1;
    },
  });
  const last = () => shown.at(-1);
  return { saver, writes, saved, signedIn, last };
}

describe('Comparison saver', () => {
  it('writes one edit at a time and sends the ones made meanwhile together on its answer', async () => {
    const { saver, writes, saved, last } = harness();
    saver.change(weigh('safety', 5), read);
    saver.change(weigh('climate', 1), read);
    saver.change(weigh('taxes', 0), read);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body.weights).toEqual({ safety: 5 });

    const first = comparison({ safety: 5 });
    writes[0]?.answer(first);
    await settle();
    expect(saved).toEqual([first]);
    expect(writes).toHaveLength(2);
    expect(writes[1]?.body.weights).toEqual({ safety: 5, climate: 1, taxes: 0 });

    const second = comparison({ safety: 5, climate: 1, taxes: 0 });
    writes[1]?.answer(second);
    await settle();
    expect(saved).toEqual([first, second]);
    expect(writes).toHaveLength(2);
    expect(last()?.queue).toEqual({ answer: second, pending: [], sending: 0 });
  });

  it('drops an answer that arrives after someone else signed in, with the edits queued behind it', async () => {
    const { saver, writes, saved, signedIn, last } = harness();
    saver.change(weigh('safety', 5), read);
    saver.change(weigh('climate', 1), read);
    signedIn.account = 'account-b';
    writes[0]?.answer(comparison({ safety: 5 }));
    await settle();
    expect(saved).toEqual([]);
    expect(writes).toHaveLength(1);
    expect(last()?.queue).toEqual({ answer: undefined, pending: [], sending: 0 });
  });

  it('drops an answer that arrives after a sign-out', async () => {
    const { saver, writes, saved, signedIn } = harness();
    saver.change(weigh('safety', 5), read);
    signedIn.account = undefined;
    writes[0]?.answer(comparison({ safety: 5 }));
    await settle();
    expect(saved).toEqual([]);
  });

  it('puts back what was saved and reads again when a write fails', async () => {
    const { saver, writes, signedIn, last } = harness();
    saver.change(weigh('safety', 5), read);
    saver.change(weigh('climate', 1), read);
    writes[0]?.fail(new ApiError(409, 'case_invalid'));
    await settle();
    expect(last()).toEqual({
      queue: { answer: undefined, pending: [], sending: 0 },
      failure: 'changed',
    });
    expect(signedIn.refetches).toBe(1);
    expect(writes).toHaveLength(1);
  });

  it('keeps the cached answer instead of spending a read when the writes are limited', async () => {
    const { saver, writes, signedIn, last } = harness();
    saver.change(weigh('safety', 5), read);
    writes[0]?.fail(new ApiError(429, 'rate_limited'));
    await settle();
    expect(last()?.failure).toBe('limited');
    expect(signedIn.refetches).toBe(0);
  });

  it('clears the failure with the next edit', async () => {
    const { saver, writes, last } = harness();
    saver.change(weigh('safety', 5), read);
    writes[0]?.fail(new UnreachableError('offline'));
    await settle();
    expect(last()?.failure).toBe('unreachable');
    saver.change(weigh('safety', 4), read);
    expect(last()?.failure).toBeUndefined();
    expect(writes[1]?.body.weights).toEqual({ safety: 4 });
  });
});

describe('Save failure', () => {
  it.each([
    [new ApiError(429, 'rate_limited'), 'limited'],
    [new ApiError(409, 'case_invalid'), 'changed'],
    [new ApiError(500, 'internal'), 'other'],
    [new UnreachableError('offline'), 'unreachable'],
    [new Error('anything else'), 'other'],
  ])('words %o as %s', (error, failure) => {
    expect(saveFailure(error)).toBe(failure);
  });
});
