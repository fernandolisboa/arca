import type { VaultIdentity } from '@arca/vault';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  holdVault,
  lockVault,
  unlockedVault,
  vaultActivity,
  vaultIdleMinutes,
} from '../src/vault-session.js';

const minutes = (count: number) => count * 60_000;
const vault = {
  accountId: '7b1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b',
  recipient: 'age1pq1synthetic',
  identity: new Uint8Array(8) as VaultIdentity,
  retained: [],
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  lockVault();
  vi.useRealTimers();
});

describe('the unlocked vault (spec 0005, R2)', () => {
  it('closes after 15 minutes without activity', () => {
    expect(vaultIdleMinutes).toBe(15);
    holdVault(vault);
    vi.advanceTimersByTime(minutes(15) - 1);
    expect(unlockedVault()).toBe(vault);
    vi.advanceTimersByTime(1);
    expect(unlockedVault()).toBeUndefined();
  });

  it('stays open while there is activity', () => {
    holdVault(vault);
    for (let step = 0; step < 4; step += 1) {
      vi.advanceTimersByTime(minutes(10));
      vaultActivity();
    }
    expect(unlockedVault()).toBe(vault);
  });

  it('closes on the first activity after the deadline, when a timer fired late', () => {
    const start = Date.now();
    holdVault(vault, start);
    vaultActivity(start + minutes(15));
    expect(unlockedVault()).toBeUndefined();
  });

  it('closes by hand', () => {
    holdVault(vault);
    lockVault();
    expect(unlockedVault()).toBeUndefined();
  });
});
