/** A display choice remembered on this device only, such as how a page lays out its items. */
export interface StoredChoice<V extends string> {
  /** The stored choice; the fallback when none was stored or storage is unavailable. */
  readonly read: () => V;
  readonly write: (value: V) => void;
}

export function storedChoice<V extends string>(
  key: string,
  values: readonly V[],
  fallback: V,
): StoredChoice<V> {
  return {
    read: () => {
      try {
        const stored = localStorage.getItem(key);
        return values.find((value) => value === stored) ?? fallback;
      } catch {
        return fallback;
      }
    },
    write: (value) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Without storage the page opens on the fallback next time; nothing else depends on it.
      }
    },
  };
}
