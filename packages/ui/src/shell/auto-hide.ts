import { useEffect, useState } from 'react';

/** Scrolling less than this, in px, keeps the bars as they are, so a shaky finger does not flicker them. */
const jitter = 4;
/** Near the top of the page the bars always show. */
const topZone = 64;

/**
 * Whether the bars stay out of the way after the page scrolled from `from` to `to`: down hides
 * them, up or near the top shows them again, and a tiny move keeps what was there.
 */
export function nextScrolledAway(away: boolean, from: number, to: number): boolean {
  if (to <= topZone) return false;
  if (to > from + jitter) return true;
  if (to < from - jitter) return false;
  return away;
}

/** True while the person is scrolling down the page with auto-hide on. */
export function useScrolledAway(enabled: boolean): boolean {
  const [away, setAway] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let last = window.scrollY;
    const onScroll = () => {
      const now = window.scrollY;
      // Small steps add up: the start point moves only once the page has moved past the jitter.
      if (Math.abs(now - last) <= jitter && now > topZone) return;
      setAway((previous) => nextScrolledAway(previous, last, now));
      last = now;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, [enabled]);
  return enabled && away;
}
