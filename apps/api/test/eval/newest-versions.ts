// The versions an evaluation over the bundled catalog reads: one for each route.

/**
 * The highest-numbered version of each route, in the order given. It may not be the one in force:
 * a version dated ahead, or the correction of an earlier period, is another version of its route.
 */
export function newestOfEachRoute<Version extends { routeId: string; number: number }>(
  versions: readonly Version[],
): Version[] {
  const newest = new Map<string, number>();
  for (const { routeId, number } of versions) {
    newest.set(routeId, Math.max(number, newest.get(routeId) ?? number));
  }
  return versions.filter(({ routeId, number }) => newest.get(routeId) === number);
}
