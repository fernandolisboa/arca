import { describe, expect, it, vi } from 'vitest';
import { recoverOnce, recoveryWindowMs } from '../src/pwa/recover.js';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => {
      values.clear();
    },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('recoverOnce', () => {
  it('recovers, then not again within the window, then again after it', () => {
    const storage = memoryStorage();
    const recover = vi.fn();
    const start = 1_800_000_000_000;
    expect(recoverOnce(() => storage, start, recover)).toBe(true);
    expect(recoverOnce(() => storage, start + recoveryWindowMs - 1, recover)).toBe(false);
    expect(recoverOnce(() => storage, start + recoveryWindowMs, recover)).toBe(true);
    expect(recover).toHaveBeenCalledTimes(2);
  });

  it('never recovers without session storage, so it cannot loop', () => {
    const recover = vi.fn();
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    expect(recoverOnce(blocked, 1_800_000_000_000, recover)).toBe(false);
    expect(recover).not.toHaveBeenCalled();
  });
});
