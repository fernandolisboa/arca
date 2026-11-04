import { readServerTime } from '@arca/db';
import { withStepError } from './step-error.js';
import { jobsDatabase, stepLogger } from './step-context.js';

export async function readDatabaseTime(): Promise<void> {
  'use step';
  await withStepError('database_unavailable', stepLogger, () => readServerTime(jobsDatabase()));
}
