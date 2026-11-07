import { runVersionCheck } from './check-steps.js';
import type { EntityId, RouteId, VersionNumber } from './workflow-arguments.js';

/**
 * The independent check of one route version for one start (ADR-0027): a single step with no
 * retries, given identifiers only and no account, since it reads public rule data and writes the
 * unowned report table.
 */
export async function checkVersion(
  startId: EntityId,
  routeId: RouteId,
  number: VersionNumber,
): Promise<void> {
  'use workflow';
  await runVersionCheck(startId, routeId, number);
}
