import { readServerTime } from '@arca/db';
import { useRuntimeConfig } from 'nitro/runtime-config';
import { databaseTargetFrom, readJobsDatabasePassword } from '../config.js';
import { roleDatabase } from '../database.js';
import { createLogger } from '../logger.js';
import { withStepError } from './step-error.js';

const logger = createLogger();
let jobs: ReturnType<typeof roleDatabase> | undefined;

function jobsDatabase() {
  jobs ??= roleDatabase(
    'app_jobs',
    databaseTargetFrom(useRuntimeConfig()['database']),
    readJobsDatabasePassword(),
    logger,
  );
  return jobs.db;
}

export async function readDatabaseTime(): Promise<void> {
  'use step';
  await withStepError('database_unavailable', logger, () => readServerTime(jobsDatabase()));
}
