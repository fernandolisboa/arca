import { createI18n } from '@arca/i18n';
import { useRuntimeConfig } from 'nitro/runtime-config';
import { auditLog } from '../audit/log.js';
import { createErasure, type Erasure } from '../account/erasure.js';
import { createRetention, type Retention } from '../account/retention.js';
import {
  databaseTargetFrom,
  readAuditDatabasePassword,
  readAuthOrigin,
  readAuthSecrets,
  readDeploymentEnvironment,
  readJobsDatabasePassword,
  readOwnOrigin,
} from '../config.js';
import { roleDatabase } from '../database.js';
import { emailRouteFor, emailSenderFor } from '../email/environment.js';
import { createNotices } from '../email/notices.js';
import { createDelivery, type Delivery } from '../notification/delivery.js';
import { createNotifier } from '../notification/notifier.js';
import { stdoutLogger } from '../logger.js';
import { reportError, startMonitoring } from '../monitoring.js';
import type { StepTelemetry } from './step-error.js';
import { startDelivery } from './start-delivery.js';

/** What workflow steps run with: each pool built once per instance, on first use. */
const stepLogger = stdoutLogger();

/**
 * The server module starts Sentry when the instance loads it; a failing step starts it too, with
 * tracing off, in case the step runs where the server module has not loaded.
 */
export const stepTelemetry: StepTelemetry = {
  logger: stepLogger,
  report: async (error, errorCode) => {
    startMonitoring({
      environment: readDeploymentEnvironment(),
      origin: readOwnOrigin(),
      traced: false,
    });
    await reportError(error, errorCode);
  },
};

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
  }),
);

export const retentionSteps = once((): Promise<Retention> =>
  Promise.resolve(
    createRetention({
      authDb: authDatabase(),
      jobsDb: jobsDatabase(),
      audit: auditLog(auditDatabase()),
      notifier: createNotifier({ db: jobsDatabase(), startDelivery }),
    }),
  ),
);

export const deliverySteps = once(async (): Promise<Delivery> =>
  createDelivery({ jobsDb: jobsDatabase(), authDb: authDatabase(), notices: await notices() }),
);
