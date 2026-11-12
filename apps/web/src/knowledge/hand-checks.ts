import { useCallback, useState } from 'react';

/** The version a mark is about: a mark never carries over to another version or content. */
export interface HandCheckedVersion {
  readonly routeId: string;
  readonly number: number;
  readonly hash: string;
}

/** The item a mark is about, and whether the admin marked it. */
export interface HandCheck {
  readonly checked: boolean;
  readonly toggle: () => void;
}

const storageKey = ({ routeId, number, hash }: HandCheckedVersion): string =>
  `arca.handChecks.${routeId}.${String(number)}.${hash}`;

function readMarks(key: string): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [],
    );
  } catch {
    return new Set();
  }
}

function writeMarks(key: string, marks: ReadonlySet<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...marks]));
  } catch {
    // Storage may be off or full; the mark still shows until the screen closes.
  }
}

/**
 * The admin's own "Conferi" marks on the items the check could not confirm, kept on this device
 * only. A mark is a reminder of what the admin looked at; it never counts as a check and never
 * activates anything (ADR-0027, "Items to check yourself").
 */
export function useHandChecks(version: HandCheckedVersion): (itemKey: string) => HandCheck {
  const key = storageKey(version);
  const [state, setState] = useState(() => ({ key, marks: readMarks(key) }));
  // Another version on the same screen reads its own marks, never the last one's.
  const marks = state.key === key ? state.marks : readMarks(key);
  const toggle = useCallback(
    (itemKey: string) => {
      setState((before) => {
        const after = new Set(before.key === key ? before.marks : readMarks(key));
        if (!after.delete(itemKey)) after.add(itemKey);
        writeMarks(key, after);
        return { key, marks: after };
      });
    },
    [key],
  );
  return useCallback(
    (itemKey: string) => ({
      checked: marks.has(itemKey),
      toggle: () => {
        toggle(itemKey);
      },
    }),
    [marks, toggle],
  );
}
