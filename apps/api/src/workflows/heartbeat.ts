import { readDatabaseTime } from './read-database-time.js';
import type { IsoDate } from './workflow-arguments.js';

/**
 * The sample workflow (spec 0001, R6): proves a run starts, reaches the database as app_jobs in a
 * step, and ends. It keeps nothing; `runDate` only tells runs apart.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the date only labels the run
export async function heartbeat(runDate: IsoDate): Promise<void> {
  'use workflow';
  await readDatabaseTime();
}
