import type { AxisName, AxisValue } from '@arca/ui/theme/ids';
import { useSyncExternalStore } from 'react';
import {
  applyPreferences,
  parsePreferences,
  resolvePreferences,
  serializePreferences,
  storageKey,
  syncThemeColor,
  type Preferences,
} from './preferences.js';

function read(): Preferences {
  try {
    return parsePreferences(localStorage.getItem(storageKey));
  } catch {
    return {};
  }
}

let current: Preferences = read();
const listeners = new Set<() => void>();

function show(next: Preferences) {
  current = next;
  applyPreferences(document.documentElement, next);
  syncThemeColor(document);
  for (const listener of listeners) listener();
}

function commit(next: Preferences) {
  try {
    if (Object.keys(next).length === 0) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, serializePreferences(next));
  } catch {
    // Storage can be off (private browsing); the choice then lasts for this visit only.
  }
  show(next);
}

/** The person's appearance choices: set one axis, or clear some back to their defaults. */
export const appearance = {
  get: (): Preferences => current,
  set: <A extends AxisName>(axis: A, value: AxisValue<A>): void => {
    commit({ ...current, [axis]: value });
  },
  /** Clears the named axes in one write, so they follow the defaults again. */
  clear: (...names: readonly AxisName[]): void => {
    const cleared = new Set<string>(names);
    commit(Object.fromEntries(Object.entries(current).filter(([name]) => !cleared.has(name))));
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/**
 * Applies the stored choices (the boot script already did in production; in development it is
 * not injected) and keeps them in step with the device's color scheme and with other tabs.
 */
export function startAppearance(): void {
  show(current);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    syncThemeColor(document);
  });
  window.addEventListener('storage', (event) => {
    if (event.storageArea !== localStorage) return;
    if (event.key === storageKey || event.key === null) show(read());
  });
}

export function useAppearance() {
  const preferences = useSyncExternalStore(appearance.subscribe, appearance.get);
  return { preferences, resolved: resolvePreferences(preferences) };
}
