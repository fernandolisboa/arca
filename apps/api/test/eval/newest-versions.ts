// The versions an evaluation over the bundled catalog reads: one for each route.

/** The newest version of each route, which is what an admin is asked to activate, in the order given. */
export function newestOfEachRoute<Version extends { routeId: string; number: number }>(
  versions: readonly Version[],
): Version[] {
  const newest = new Map<string, number>();
  for (const { routeId, number } of versions) {
    newest.set(routeId, Math.max(number, newest.get(routeId) ?? number));
  }
  return versions.filter(({ routeId, number }) => newest.get(routeId) === number);
}
