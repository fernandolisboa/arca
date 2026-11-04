import { readServerTime } from '@arca/db';
import { withStepError } from './step-error.js';
import { jobsDatabase, stepTelemetry } from './step-context.js';

export async function readDatabaseTime(): Promise<void> {
  'use step';
  await withStepError('database_unavailable', stepTelemetry, () => readServerTime(jobsDatabase()));
}
