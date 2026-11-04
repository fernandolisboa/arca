import { createI18n } from '@arca/i18n';
import { useRuntimeConfig } from 'nitro/runtime-config';
import { auditLog } from '../audit/log.js';
import { createErasure, type Erasure } from '../account/erasure.js';
import { createRetention, type Retention } from '../account/retention.js';
import { tombstonesFor } from '../account/tombstones.js';
import {
  databaseTargetFrom,
  readAuditDatabasePassword,
  readAuthOrigin,
  readAuthSecrets,
  readDeploymentEnvironment,
  readJobsDatabasePassword,
} from '../config.js';
import { roleDatabase } from '../database.js';
import { emailRouteFor, emailSenderFor } from '../email/environment.js';
import { createNotices } from '../email/notices.js';
import { stdoutLogger } from '../logger.js';

/** What workflow steps run with: each pool built once per instance, on first use. */
export const stepLogger = stdoutLogger();

const target = () => databaseTargetFrom(useRuntimeConfig()['database']);
let jobs: ReturnType<typeof roleDatabase> | undefined;
let auth: ReturnType<typeof roleDatabase> | undefined;
let audit: ReturnType<typeof roleDatabase> | undefined;

export function jobsDatabase() {
  jobs ??= roleDatabase('app_jobs', target(), readJobsDatabasePassword(), stepLogger);
  return jobs.db;
}

function authDatabase() {
  auth ??= roleDatabase('app_auth', target(), readAuthSecrets().databasePassword, stepLogger);
  return auth.db;
}

function auditDatabase() {
  audit ??= roleDatabase('app_audit', target(), readAuditDatabasePassword(), stepLogger);
  return audit.db;
}

/** Built once per instance; a failed build is retried by the next step attempt, not cached. */
function once<T>(build: () => Promise<T>): () => Promise<T> {
  let built: Promise<T> | undefined;
  return () => {
    built ??= build();
    built.catch(() => {
      built = undefined;
    });
    return built;
  };
}

const notices = once(async () => {
  const environment = readDeploymentEnvironment();
  const email = emailSenderFor(emailRouteFor(environment), environment, authDatabase);
  return createNotices({ email, i18n: await createI18n(), origin: readAuthOrigin() });
});

export const erasureSteps = once(async (): Promise<Erasure> =>
  createErasure({
    authDb: authDatabase(),
    jobsDb: jobsDatabase(),
    audit: auditLog(auditDatabase()),
    notices: await notices(),
    tombstones: tombstonesFor(readDeploymentEnvironment()),
  }),
);

export const retentionSteps = once(async (): Promise<Retention> =>
  createRetention({
    authDb: authDatabase(),
    jobsDb: jobsDatabase(),
    audit: auditLog(auditDatabase()),
    notices: await notices(),
  }),
);
