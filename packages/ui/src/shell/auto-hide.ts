import { useEffect, useState } from 'react';

/** Scrolling less than this, in px, keeps the bars as they are, so a shaky finger does not flicker them. */
const jitter = 4;
/** Near the top of the page the bars always show. */
const topZone = 64;

/** The bars and docks slide in and out with the theme's motion, so motion off moves them at once. */
export const slideClass = 'transition-[translate] duration-(--arca-duration-base) ease-out';

/**
 * Whether the bars leave after the page scrolled from `from` to `to`, or `null` to keep them as
 * they are: down hides them, up or near the top shows them, and a move within the jitter waits.
 */
export function nextScrolledAway(from: number, to: number): boolean | null {
  if (to <= topZone) return false;
  if (Math.abs(to - from) <= jitter) return null;
  return to > from;
}

/** True while the person is scrolling down the page with auto-hide on. */
export function useScrolledAway(enabled: boolean): boolean {
  const [away, setAway] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let last = window.scrollY;
    const onScroll = () => {
      const now = window.scrollY;
      const next = nextScrolledAway(last, now);
      // Small steps add up: the start point moves only once a step decides something.
      if (next === null) return;
      setAway(next);
      last = now;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      setAway(false);
    };
  }, [enabled]);
  return enabled && away;
}
