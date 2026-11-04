import { describe, expect, it, vi } from 'vitest';
import { forEachAccount } from '../src/account/each-account.js';
import { eraseAccountNow, type Erasure } from '../src/account/erasure.js';
import { eraseAccount } from '../src/workflows/erase-account.js';
import { entityId } from '../src/workflows/workflow-arguments.js';

const { order, due } = vi.hoisted(() => ({ order: [] as string[], due: { value: true } }));

vi.mock('../src/workflows/erasure-steps.js', () => {
  const step = (name: string) => () => {
    order.push(name);
    return Promise.resolve(name === 'erasable' ? due.value : undefined);
  };
  return {
    erasable: step('erasable'),
    eraseOwnedEntries: step('eraseOwnedEntries'),
    sendCompletionNotice: step('sendCompletionNotice'),
    eraseAuthRows: step('eraseAuthRows'),
    recordErased: step('recordErased'),
  };
});

const accountId = '3f2b8a4e-6c1d-4e5f-9a7b-0c1d2e3f4a5b';

function recordingErasure(): { erasure: Erasure; calls: string[] } {
  const calls: string[] = [];
  const step = (name: string) => () => {
    calls.push(name);
    return Promise.resolve();
  };
  return {
    calls,
    erasure: {
      erasable: () => {
        calls.push('erasable');
        return Promise.resolve(due.value);
      },
      eraseOwnedEntries: step('eraseOwnedEntries'),
      sendCompletionNotice: step('sendCompletionNotice'),
      eraseAuthRows: step('eraseAuthRows'),
      recordErased: step('recordErased'),
    },
  };
}

describe('eraseAccount (spec 0004, R9)', () => {
  it.each([true, false])(
    'runs the steps in the same order as eraseAccountNow, which the database tests use (due: %s)',
    async (isDue) => {
      due.value = isDue;
      order.length = 0;
      await eraseAccount(entityId(accountId));
      const { erasure, calls } = recordingErasure();
      await eraseAccountNow(erasure, accountId);
      expect(order).toEqual(calls);
      expect(calls.at(-1)).toBe(isDue ? 'recordErased' : 'erasable');
    },
  );
});

describe('forEachAccount', () => {
  it('starts every account even when one start fails, then throws the failure', async () => {
    const started: string[] = [];
    const failure = new Error('start failed');
    const run = forEachAccount(['a', 'b', 'c'], (id) => {
      started.push(id);
      return id === 'a' ? Promise.reject(failure) : Promise.resolve();
    });
    await expect(run).rejects.toBe(failure);
    expect(started).toEqual(['a', 'b', 'c']);
  });
});
