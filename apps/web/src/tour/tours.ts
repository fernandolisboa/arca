import { navTargetIds } from '@arca/ui';

/** One coach mark. Its text is `tour.<tour>.<step>.title` and `.body` in the catalog. */
export interface TourStep {
  readonly id: string;
  /** Element ids in order of preference; the first one on screen gets the spotlight. */
  readonly targetIds: readonly string[];
}

export interface Tour {
  readonly id: string;
  /** The screen the tour runs on. */
  readonly path: string;
  readonly steps: readonly TourStep[];
}

/** The title and lead of the screen's `Page`, which a screen hint points at. */
export const pageIntroId = 'page-intro';

const destination = (id: string): TourStep => ({ id, targetIds: navTargetIds(id) });

/** A one-step hint, shown the first time its screen opens. */
const screenHint = (id: string, path: string): Tour => ({
  id,
  path,
  steps: [{ id: 'screen', targetIds: [pageIntroId] }],
});

/** The first-run walk through the main areas, by way of the navigation: a step's id is its destination's. */
export const appTour: Tour = {
  id: 'app',
  path: '/',
  steps: ['home', 'family', 'compare', 'vault', 'settings'].map(destination),
};

/**
 * A new screen adds its hint here, its two messages to the catalog and its id to the tours the
 * e2e suites start with (`e2e/tour.ts`); the tour code itself does not change.
 */
export const screenHints: readonly Tour[] = [
  screenHint('family', '/family'),
  screenHint('compare', '/compare'),
  screenHint('vault', '/vault'),
  screenHint('knowledge', '/knowledge'),
];

export const tours: readonly Tour[] = [appTour, ...screenHints];

/**
 * The tour to show on a screen, if any. The first-run tour comes before every hint, so a hint
 * never appears to someone who has not been shown around yet.
 */
export function nextTour(pathname: string, seen: ReadonlySet<string>): Tour | undefined {
  const pending = seen.has(appTour.id) ? screenHints : [appTour];
  return pending.find((tour) => tour.path === pathname && !seen.has(tour.id));
}

/** What the tour reads from the signed-in session. */
export interface TourAccount {
  readonly confirmed: boolean;
  readonly deletionDueAt: string | null;
  readonly pendingPasskeyUntil: string | null;
  readonly recoveryPending: boolean;
}

/**
 * Whether the tour can run: only a confirmed account sees its screens, and one with a security
 * notice pending (a new passkey, a recovery, a deletion) reads that notice first, uncovered.
 */
export function tourReady(account: TourAccount | undefined): boolean {
  return (
    account?.confirmed === true &&
    account.deletionDueAt === null &&
    account.pendingPasskeyUntil === null &&
    !account.recoveryPending
  );
}
