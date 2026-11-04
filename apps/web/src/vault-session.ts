import type { VaultIdentity } from '@arca/vault';
import { useSyncExternalStore } from 'react';

/** An unlocked vault stays open this long without activity, or while the page is hidden. */
export const vaultIdleMinutes = 15;
const idleMilliseconds = vaultIdleMinutes * 60_000;

export interface UnlockedVault {
  readonly accountId: string;
  readonly recipient: string;
  readonly identity: VaultIdentity;
}

/**
 * The unlocked identity lives here, in memory only, and nowhere else in the page (spec 0005, R2):
 * dropped on sign-out, after 15 minutes idle and after 15 minutes hidden.
 */
let unlocked: UnlockedVault | undefined;
let deadline = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

export function lockVault(): void {
  clearTimeout(timer);
  timer = undefined;
  if (unlocked === undefined) return;
  unlocked = undefined;
  changed();
}

function extend(now: number): void {
  deadline = now + idleMilliseconds;
  clearTimeout(timer);
  timer = setTimeout(lockVault, idleMilliseconds);
}

export function holdVault(vault: UnlockedVault, now = Date.now()): void {
  unlocked = vault;
  extend(now);
  changed();
}

/**
 * Activity while the page is visible, or the page being hidden or shown again, restarts the
 * 15 minutes. A timer can fire late after the device sleeps, so the deadline is checked first.
 */
export function vaultActivity(now = Date.now()): void {
  if (unlocked === undefined) return;
  if (now >= deadline) {
    lockVault();
    return;
  }
  extend(now);
}

export function watchVaultActivity(page: Window): void {
  const touch = () => {
    vaultActivity();
  };
  for (const event of ['pointerdown', 'keydown'] as const) {
    page.addEventListener(event, touch, { capture: true, passive: true });
  }
  page.document.addEventListener('visibilitychange', touch);
}

export function unlockedVault(): UnlockedVault | undefined {
  return unlocked;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUnlockedVault(accountId: string | undefined): UnlockedVault | undefined {
  const vault = useSyncExternalStore(subscribe, unlockedVault);
  return vault?.accountId === accountId ? vault : undefined;
}
