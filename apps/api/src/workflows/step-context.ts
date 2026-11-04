import { createI18n } from '@arca/i18n';
import { useRuntimeConfig } from 'nitro/runtime-config';
import { auditLog } from '../audit/log.js';
import { createErasure, type Erasure } from '../account/erasure.js';
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

let erasure: Promise<Erasure> | undefined;

export function erasureSteps(): Promise<Erasure> {
  erasure ??= (async () => {
    const environment = readDeploymentEnvironment();
    const email = emailSenderFor(emailRouteFor(environment), environment, authDatabase);
    const notices = createNotices({ email, i18n: await createI18n(), origin: readAuthOrigin() });
    return createErasure({
      authDb: authDatabase(),
      jobsDb: jobsDatabase(),
      audit: auditLog(auditDatabase()),
      notices,
      tombstones: tombstonesFor(environment),
    });
  })();
  // A failed build is retried by the step's next attempt instead of being cached.
  erasure.catch(() => {
    erasure = undefined;
  });
  return erasure;
}
