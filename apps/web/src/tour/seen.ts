import { useSyncExternalStore } from 'react';

/** Which tours this device has already shown: tour ids only, nothing about the person. */
export const storageKey = 'arca.tour';

const version = 1;

export function parseSeen(raw: string | null): ReadonlySet<string> {
  if (raw === null) return new Set();
  try {
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== 'object' || stored === null) return new Set();
    const { v, seen } = stored as { v?: unknown; seen?: unknown };
    if (v !== version || !Array.isArray(seen)) return new Set();
    return new Set(seen.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

export function serializeSeen(seen: ReadonlySet<string>): string {
  return JSON.stringify({ v: version, seen: [...seen].sort() });
}

function read(): ReadonlySet<string> {
  try {
    return parseSeen(localStorage.getItem(storageKey));
  } catch {
    return new Set();
  }
}

let current = read();
const listeners = new Set<() => void>();

function show(next: ReadonlySet<string>) {
  current = next;
  for (const listener of listeners) listener();
}

function commit(next: ReadonlySet<string>) {
  try {
    localStorage.setItem(storageKey, serializeSeen(next));
  } catch {
    // Storage can be off (private browsing); the tour then counts as seen for this visit only.
  }
  show(next);
}

export const seenTours = {
  get: (): ReadonlySet<string> => current,
  add: (id: string): void => {
    commit(new Set([...current, id]));
  },
  /** Makes the named tours show again. */
  forget: (...ids: readonly string[]): void => {
    commit(new Set([...current].filter((id) => !ids.includes(id))));
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Keeps the tours in step with other tabs, so one finished there does not start again here. */
export function startTourSync(): void {
  window.addEventListener('storage', (event) => {
    if (event.storageArea !== localStorage) return;
    if (event.key === storageKey || event.key === null) show(read());
  });
}

export function useSeenTours(): ReadonlySet<string> {
  return useSyncExternalStore(seenTours.subscribe, seenTours.get);
}
