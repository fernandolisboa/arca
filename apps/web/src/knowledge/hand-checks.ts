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

/** Where a version's marks are kept: a mark never carries over to another version or content. */
export const handCheckKey = ({ routeId, number, hash }: HandCheckedVersion): string =>
  `arca.handChecks.${routeId}.${String(number)}.${hash}`;

/** The marked item keys in what storage held; anything unreadable counts as no mark. */
export function parseMarks(stored: string | null): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(stored ?? '[]');
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [],
    );
  } catch {
    return new Set();
  }
}

/** The marks with one item's mark flipped. */
export function toggledMarks(marks: ReadonlySet<string>, itemKey: string): ReadonlySet<string> {
  const after = new Set(marks);
  if (!after.delete(itemKey)) after.add(itemKey);
  return after;
}

function readMarks(key: string): ReadonlySet<string> {
  try {
    return parseMarks(localStorage.getItem(key));
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
  const key = handCheckKey(version);
  const [state, setState] = useState(() => ({ key, marks: readMarks(key) }));
  // Another version on the same screen reads its own marks once; React redoes this render with them.
  if (state.key !== key) setState({ key, marks: readMarks(key) });
  const { marks } = state;
  const toggle = useCallback(
    (itemKey: string) => {
      const after = toggledMarks(marks, itemKey);
      writeMarks(key, after);
      setState({ key, marks: after });
    },
    [key, marks],
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
