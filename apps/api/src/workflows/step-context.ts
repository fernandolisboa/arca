import { createI18n } from '@arca/i18n';
import { countryGuide } from '@arca/knowledge';
import { useRuntimeConfig } from 'nitro/runtime-config';
import { auditLog } from '../audit/log.js';
import { createErasure, type Erasure } from '../account/erasure.js';
import { createRetention, type Retention } from '../account/retention.js';
import {
  databaseTargetFrom,
  readAuditDatabasePassword,
  readAnthropicApiKey,
  readAuthOrigin,
  readAuthSecrets,
  readDeploymentEnvironment,
  readJobsDatabasePassword,
  readOfflineRuleCheck,
  readOwnOrigin,
  readVapidPrivateKey,
} from '../config.js';
import { roleDatabase } from '../database.js';
import { emailRouteFor, emailSenderFor } from '../email/environment.js';
import { createNotices } from '../email/notices.js';
import { checkFetcherFor, ruleCheckerFor } from '../knowledge/check/environment.js';
import { type VersionCheck, createVersionCheck } from '../knowledge/check/run.js';
import { postgresCheckReportStore } from '../knowledge/check/store.js';
import { createCheckSubjects } from '../knowledge/versions.js';
import { createDelivery, deliverNow, type Delivery } from '../notification/delivery.js';
import { createNotifier } from '../notification/notifier.js';
import { vapidPushSender } from '../notification/push.js';
import { configuredVapidKeys } from '../notification/vapid.js';
import { stdoutLogger } from '../logger.js';
import { createDocuments } from '../vault/documents.js';
import { unconnectedObjectStorage } from '../vault/object-storage.js';
import { objectStorageFor } from '../vault/storage-environment.js';
import { reportError, startMonitoring } from '../monitoring.js';
import type { StepTelemetry } from './step-error.js';

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

/** The documents on the app_jobs pool; where no store is connected, erasing any object fails. */
const jobDocuments = () =>
  createDocuments({
    db: jobsDatabase(),
    storage: objectStorageFor(readDeploymentEnvironment())?.storage ?? unconnectedObjectStorage,
    audit: auditLog(auditDatabase()),
  });

export const erasureSteps = once(async (): Promise<Erasure> =>
  createErasure({
    authDb: authDatabase(),
    jobsDb: jobsDatabase(),
    audit: auditLog(auditDatabase()),
    notices: await notices(),
    documents: jobDocuments(),
  }),
);

/** Push goes out only where the environment has its VAPID key pair. */
function pushSender() {
  const keys = configuredVapidKeys(
    readDeploymentEnvironment(),
    readVapidPrivateKey(),
    stepTelemetry.logger,
  );
  return keys === undefined ? {} : { push: vapidPushSender({ keys, contact: readAuthOrigin() }) };
}

export const deliverySteps = once(async (): Promise<Delivery> =>
  createDelivery({
    jobsDb: jobsDatabase(),
    authDb: authDatabase(),
    notices: await notices(),
    logger: stepTelemetry.logger,
    ...pushSender(),
  }),
);

/**
 * The inactivity warning is delivered in the job's own step, before the account is marked, so no
 * account is marked, and later erased, without its warning sent (spec 0004, R10).
 */
export const retentionSteps = once(async (): Promise<Retention> => {
  const delivery = await deliverySteps();
  return createRetention({
    authDb: authDatabase(),
    jobsDb: jobsDatabase(),
    audit: auditLog(auditDatabase()),
    documents: jobDocuments(),
    notifier: createNotifier({
      db: jobsDatabase(),
      startDelivery: (accountId, messageId) =>
        deliverNow(delivery, accountId, messageId, stepTelemetry.logger),
    }),
  });
});

/**
 * The independent check (ADR-0027) on the app_jobs pool, which reads public rule data and inserts
 * the report: no account, no case data. Where no checker is configured nothing starts a check, so
 * a step that runs anyway stores nothing.
 */
export const checkSteps = once((): Promise<VersionCheck> => {
  const environment = readDeploymentEnvironment();
  const checker = ruleCheckerFor(environment, readAnthropicApiKey());
  if (checker === undefined) {
    return Promise.resolve(() => {
      stepLogger.error({ route: 'workflow:check-version', errorCode: 'check_not_configured' });
      return Promise.resolve();
    });
  }
  return Promise.resolve(
    createVersionCheck({
      subject: createCheckSubjects(),
      guide: countryGuide,
      fetcher: checkFetcherFor(environment, readOfflineRuleCheck()),
      checker,
      store: postgresCheckReportStore(jobsDatabase),
      logger: stepLogger,
      now: () => performance.now(),
    }),
  );
});
