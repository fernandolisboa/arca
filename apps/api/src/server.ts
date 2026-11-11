import { createI18n, type I18n } from '@arca/i18n';
import {
  comparisonCatalog,
  countryGuide,
  pinnedCountries,
  routeCatalog,
  routeIds,
} from '@arca/knowledge';
import { useRuntimeConfig } from 'nitro/runtime-config';
import { createDataExports } from './account/data-export.js';
import { createAccountDeletion, type AccountDeletion } from './account/deletion.js';
import { forEachAccount } from './account/each-account.js';
import { linkAccounts } from './account/links.js';
import { accounts } from './auth/auth.js';
import { createApp } from './app.js';
import { auditLog, auditReader, type AuditLog } from './audit/log.js';
import { createAuth, credentialStore } from './auth/auth.js';
import { createCaseFiles } from './case/case-files.js';
import { createCaseIntake } from './case/intake.js';
import { extractorFor } from './intake/environment.js';
import { createDocuments } from './vault/documents.js';
import { objectStorageFor } from './vault/storage-environment.js';
import { createVault } from './vault/vault.js';
import { rateLimiter, type RateLimiter } from './auth/rate-limit.js';
import { clientAddressFor } from './client-address.js';
import { createEnrollment, ownerCode, type Enrollment } from './auth/enrollment.js';
import { createDevices, type Devices } from './auth/devices.js';
import { createInvites, type Invites } from './auth/invites.js';
import { recoveryKits, type RecoveryKits } from './auth/recovery-kit.js';
import { createRecovery, type Recovery } from './auth/recovery.js';
import { registration, registrationHooks, type Registration } from './auth/registration.js';
import { authService, type AuthService } from './auth/service.js';
import { accountNotice, type AccountNotice } from './auth/account-notices.js';
import { createStepUp, type StepUpService, type StepUpSpender } from './auth/step-up.js';
import { createAdminGrants } from './knowledge/admin-grants.js';
import { adminRole } from './knowledge/admins.js';
import { ownerList } from './knowledge/owner-list.js';
import { createKnowledgeDecisions, type KnowledgeDecisions } from './knowledge/decisions.js';
import { todayInSaoPaulo } from './calendar.js';
import { createRuleReportReview } from './knowledge/reports.js';
import { createRuleSummaries } from './knowledge/summaries.js';
import { summarizerFor } from './knowledge/summary/environment.js';
import { ruleSummaryPromptVersion } from './knowledge/summary/prompt.js';
import { postgresSummaryStore } from './knowledge/summary/store.js';
import { createCheckSubjects, createKnowledgeVersions } from './knowledge/versions.js';
import { createVersionChecks } from './knowledge/checks.js';
import { ruleCheckerFor } from './knowledge/check/environment.js';
import { postgresCheckProgressStore } from './knowledge/check/progress.js';
import { postgresCheckStarts } from './knowledge/check/starts.js';
import { postgresCheckReportStore } from './knowledge/check/store.js';
import {
  databaseTargetFrom,
  readAnthropicApiKey,
  readApiSecrets,
  readAuditDatabasePassword,
  readAuthOrigin,
  readAuthSecrets,
  readCronSecret,
  readDeploymentEnvironment,
  readEngineCommit,
  readEnrollmentCodeHash,
  readOwnOrigin,
  readScriptedIntake,
  readScriptedRuleSummary,
  readRateLimitKey,
  readVapidPrivateKey,
} from './config.js';
import { apiDatabase, auditDatabase, authDatabase } from './database.js';
import {
  accountsOpenWith,
  emailRouteFor,
  emailSenderFor,
  outboxReaderFor,
} from './email/environment.js';
import { stdoutLogger } from './logger.js';
import { createNotificationChannels } from './notification/channels.js';
import { createNotifier } from './notification/notifier.js';
import { configuredVapidKeys } from './notification/vapid.js';
import { monitorRequests, sendToSentry, startMonitoring, tunnelFor } from './monitoring.js';
import { enforceRetention } from './workflows/enforce-retention.js';
import { eraseAccount } from './workflows/erase-account.js';
import { heartbeat } from './workflows/heartbeat.js';
import { startCheck } from './workflows/start-check.js';
import { startDelivery } from './workflows/start-delivery.js';
import { startWorkflow } from './workflows/start-workflow.js';
import { entityId } from './workflows/workflow-arguments.js';

const logger = stdoutLogger();

let database: ReturnType<typeof apiDatabase> | undefined;

/**
 * Connects on first use, so a missing setting surfaces as an unavailable database in
 * `GET /v1/health` instead of failing every request, the static shell included.
 */
function connected() {
  database ??= apiDatabase(
    databaseTargetFrom(useRuntimeConfig()['database']),
    readApiSecrets().databasePassword,
    logger,
  );
  return database;
}

let authPool: ReturnType<typeof authDatabase> | undefined;

/** The app_auth pool, shared by Better Auth and the outbox. */
function authConnection() {
  authPool ??= authDatabase(
    databaseTargetFrom(useRuntimeConfig()['database']),
    readAuthSecrets().databasePassword,
    logger,
  );
  return authPool.db;
}

const environment = readDeploymentEnvironment();
const emailRoute = emailRouteFor(environment);
const accountsOpen = accountsOpenWith(emailRoute);

/** The audit log on the app_audit pool, for services built before the auth parts are. */
const lazyAudit: Pick<AuditLog, 'record'> = {
  record: async (entry) => (await authParts()).audit.record(entry),
};

/** Who is an admin (ADR-0027): the owner list, then the role's history on the app_api pool. */
const role = adminRole(() => connected().db, ownerList[environment]);

let knowledgeInstance: KnowledgeDecisions | undefined;

/**
 * One service for the process, since it caches which decisions count; it stores decisions on the
 * app_auth pool and reads them on the app_api pool.
 */
function knowledgeDecisions(): KnowledgeDecisions {
  knowledgeInstance ??= createKnowledgeDecisions({
    db: connected().db,
    authDb: authConnection,
    audit: lazyAudit,
    catalog: routeCatalog,
    comparisons: comparisonCatalog,
    role,
    origin: readAuthOrigin(),
    logger,
  });
  return knowledgeInstance;
}

let limiterInstance: RateLimiter | undefined;

/**
 * The auth routes' counters, on the app_auth pool, keyed by the environment's HMAC key; built on
 * first use, so a missing key fails the auth routes, not the whole server.
 */
const limiter: RateLimiter = {
  hit: (rule, subject) => built().hit(rule, subject),
  sweep: () => built().sweep(),
};

function built(): RateLimiter {
  limiterInstance ??= rateLimiter({ db: authConnection(), key: readRateLimitKey() });
  return limiterInstance;
}

interface AuthParts {
  readonly auth: AuthService;
  readonly stepUp: StepUpService & StepUpSpender;
  readonly enrollment: Enrollment;
  readonly registration: Registration;
  readonly recoveryKits: RecoveryKits;
  readonly invites: Invites;
  readonly devices: Devices;
  readonly recovery: Recovery;
  readonly audit: AuditLog;
  readonly i18n: I18n;
  readonly accountDeletion: AccountDeletion;
  readonly adminNotice: AccountNotice<'admin_role_changed'>;
}

let parts: Promise<AuthParts> | undefined;

/** Better Auth and the routes beside it on the app_auth pool, built on the first auth request. */
function authParts(): Promise<AuthParts> {
  parts ??= (async () => {
    const target = databaseTargetFrom(useRuntimeConfig()['database']);
    const audit = auditLog(auditDatabase(target, readAuditDatabasePassword(), logger).db);
    const origin = readAuthOrigin();
    const email = emailSenderFor(emailRoute, environment, authConnection);
    const i18n = await createI18n();
    // Notifications are recorded on the app_api pool, under the notified account's identity.
    const notifier = createNotifier({ db: connected().db, startDelivery });
    const db = authConnection();
    const enrollmentCode = ownerCode(readEnrollmentCodeHash(environment));
    const hooks = registrationHooks({ db, audit, ownerCode: enrollmentCode });
    const auth = createAuth({
      db,
      secret: readAuthSecrets().secret,
      origin,
      logger,
      audit,
      notifier,
      limiter,
      registration: hooks,
    });
    const invites = createInvites({
      db,
      audit,
      email,
      notifier,
      i18n,
      origin,
      logger,
      startErasure: (id) => startWorkflow(eraseAccount, [entityId(id)]),
      linkAccounts: linkAccounts(connected().db),
    });
    const devices = createDevices({ db, audit, notifier, logger, origin });
    return {
      auth: authService(auth),
      stepUp: createStepUp({ db, credentials: credentialStore(db), audit, origin, logger }),
      enrollment: createEnrollment({ db, email, i18n, origin, ownerCode: enrollmentCode }),
      registration: registration(auth, hooks, enrollmentCode, logger, invites.accepted),
      recoveryKits: recoveryKits({ db, audit, notifier, logger }),
      invites,
      devices,
      recovery: createRecovery({
        db,
        audit,
        email,
        notifier,
        i18n,
        origin,
        logger,
        emailAvailable: accountsOpen,
        status: devices.status,
      }),
      audit,
      i18n,
      accountDeletion: createAccountDeletion({ db, audit, notifier, logger }),
      adminNotice: accountNotice<'admin_role_changed'>({
        notifier,
        logger,
        label: 'AdminRoleNotice',
      }),
    };
  })();
  // A failed build is retried on the next request instead of being cached.
  parts.catch(() => {
    parts = undefined;
  });
  return parts;
}

/** The vault on the app_api pool, with the account's active passkeys read on app_auth. */
async function vaultService() {
  const { audit } = await authParts();
  const credentials = credentialStore(authConnection());
  return createVault({
    db: connected().db,
    activeCredentials: async (accountId) =>
      (await credentials.activeOf(accountId)).map(({ credentialId }) => credentialId),
    emailsOf: (accountIds) => accounts.emailsOf(authConnection(), accountIds),
    audit,
  });
}

const documentStorage = objectStorageFor(environment);

/** The documents on the app_api pool, with their ciphertext in the environment's store. */
async function documentService() {
  const { audit } = await authParts();
  if (documentStorage === undefined) throw new Error('no object store is connected');
  return createDocuments({ db: connected().db, storage: documentStorage.storage, audit });
}

/** The account's channels on the app_api pool, audited on app_audit. */
async function notificationChannels() {
  const { audit } = await authParts();
  return createNotificationChannels({ db: connected().db, audit });
}

const pushKey = configuredVapidKeys(environment, readVapidPrivateKey(), logger)?.publicKey ?? null;

/**
 * Read once at load, but a missing setting only refuses state-changing requests (the auth routes
 * then fail and log it), so `GET /v1/health` and the static shell keep answering.
 */
const ownOrigin = readOwnOrigin();

const withOrigin = (origin: string | undefined) => (origin === undefined ? {} : { origin });

const outbox = outboxReaderFor(environment, authConnection);

const extractor = extractorFor(environment, readAnthropicApiKey(), readScriptedIntake());
const intake =
  extractor === undefined
    ? undefined
    : createCaseIntake({
        db: () => connected().db,
        audit: lazyAudit,
        logger,
        extractor,
        today: () => todayInSaoPaulo(),
        now: () => performance.now(),
      });

const knowledgeVersions = createKnowledgeVersions({
  states: () => knowledgeDecisions().states(),
  today: () => todayInSaoPaulo(),
});
const ruleChecker = ruleCheckerFor(environment, readAnthropicApiKey());
const versionChecks =
  ruleChecker === undefined
    ? undefined
    : createVersionChecks({
        versions: knowledgeVersions,
        subject: createCheckSubjects(),
        guide: countryGuide,
        checker: ruleChecker,
        reports: postgresCheckReportStore(() => connected().db),
        starts: postgresCheckStarts(() => connected().db),
        progress: postgresCheckProgressStore(() => connected().db),
        run: startCheck,
        logger,
        now: () => Date.now(),
      });
const summarizer = summarizerFor(environment, readAnthropicApiKey(), readScriptedRuleSummary());
const ruleSummaries =
  summarizer === undefined
    ? undefined
    : createRuleSummaries({
        versions: knowledgeVersions,
        ...summarizer,
        store: postgresSummaryStore(() => connected().db),
        promptVersion: ruleSummaryPromptVersion,
        logger,
        now: () => performance.now(),
      });

const monitored = startMonitoring({ environment, origin: ownOrigin });
const tunnel = tunnelFor({ environment, origin: ownOrigin, send: sendToSentry });

const app = createApp({
  checkDatabase: () => connected().checkDatabase(),
  logger,
  ...(monitored ? { monitor: monitorRequests } : {}),
  syntheticError: environment === 'preview',
  cron: {
    readSecret: readCronSecret,
    startHeartbeat: (runDate) => startWorkflow(heartbeat, [runDate]),
    startRetention: (runDate) => startWorkflow(enforceRetention, [runDate]),
    // A run per account from this server-side scan; a failed run is started again the next day,
    // since every step is idempotent and an erased account stays noted until its event is recorded.
    startDueErasures: async () =>
      forEachAccount(await accounts.dueForErasure(authConnection()), (id) =>
        startWorkflow(eraseAccount, [entityId(id)]),
      ),
    sweepRateLimits: () => limiter.sweep(),
  },
  ...withOrigin(ownOrigin),
  accountsOpen,
  auth: {
    handle: async (request) => (await authParts()).auth.handle(request),
    signedIn: async (headers) => (await authParts()).auth.signedIn(headers),
    refresh: async (headers) => (await authParts()).auth.refresh(headers),
  },
  stepUp: {
    options: async (signedIn, request) => (await authParts()).stepUp.options(signedIn, request),
    verify: async (signedIn, challengeId, response) =>
      (await authParts()).stepUp.verify(signedIn, challengeId, response),
    consume: async (signedIn, purpose, action) =>
      (await authParts()).stepUp.consume(signedIn, purpose, action),
    vaultUnlocked: async (signedIn) => (await authParts()).stepUp.vaultUnlocked(signedIn),
  },
  enrollment: {
    enrollOwner: async (request) => (await authParts()).enrollment.enrollOwner(request),
  },
  registration: {
    options: async (headers, request) => (await authParts()).registration.options(headers, request),
    verify: async (headers, request) => (await authParts()).registration.verify(headers, request),
  },
  recoveryKits: {
    status: async (accountId) => (await authParts()).recoveryKits.status(accountId),
    issueFirst: async (accountId) => (await authParts()).recoveryKits.issueFirst(accountId),
    regenerate: async (accountId) => (await authParts()).recoveryKits.regenerate(accountId),
    confirm: async (accountId) => (await authParts()).recoveryKits.confirm(accountId),
  },
  invites: {
    create: async (inviterId, email) => (await authParts()).invites.create(inviterId, email),
    list: async (inviterId) => (await authParts()).invites.list(inviterId),
    details: async (token) => (await authParts()).invites.details(token),
    confirm: async (inviterId, inviteId) =>
      (await authParts()).invites.confirm(inviterId, inviteId),
    decline: async (inviterId, inviteId) =>
      (await authParts()).invites.decline(inviterId, inviteId),
    accepted: async (inviteId) => (await authParts()).invites.accepted(inviteId),
  },
  devices: {
    list: async (signedIn) => (await authParts()).devices.list(signedIn),
    revokeSession: async (signedIn, sessionId) =>
      (await authParts()).devices.revokeSession(signedIn, sessionId),
    revokePasskey: async (signedIn, passkeyId, beforeRevoke) =>
      (await authParts()).devices.revokePasskey(signedIn, passkeyId, beforeRevoke),
    revokeOtherSessions: async (signedIn) =>
      (await authParts()).devices.revokeOtherSessions(signedIn),
    addOptions: async (signedIn) => (await authParts()).devices.addOptions(signedIn),
    add: async (signedIn, challengeId, response) =>
      (await authParts()).devices.add(signedIn, challengeId, response),
    status: async (accountId) => (await authParts()).devices.status(accountId),
  },
  recovery: {
    start: async (email, behind) => (await authParts()).recovery.start(email, behind),
    redeem: async (token, code) => (await authParts()).recovery.redeem(token, code),
    options: async (token) => (await authParts()).recovery.options(token),
    verify: async (token, response, device) =>
      (await authParts()).recovery.verify(token, response, device),
  },
  authLimits: {
    limiter,
    clientAddress: clientAddressFor(environment, () => {
      logger.error({ errorName: 'ClientAddressUnknown' });
    }),
  },
  audit: { events: (accountId, query) => auditReader(connected().db).events(accountId, query) },
  accountDeletion: {
    request: async (accountId) => (await authParts()).accountDeletion.request(accountId),
    cancel: async (accountId) => (await authParts()).accountDeletion.cancel(accountId),
  },
  dataExports: {
    // Built per export, so a broken app_api setting fails only this route.
    build: async (accountId) => {
      const { audit, i18n } = await authParts();
      return createDataExports({
        authDb: authConnection(),
        apiDb: connected().db,
        audit,
        i18n,
      }).build(accountId);
    },
  },
  vault: {
    status: (accountId) => vaultService().then((vault) => vault.status(accountId)),
    setUp: (accountId, request) => vaultService().then((vault) => vault.setUp(accountId, request)),
    envelopes: (accountId) => vaultService().then((vault) => vault.envelopes(accountId)),
    addEnvelope: (accountId, sealed) =>
      vaultService().then((vault) => vault.addEnvelope(accountId, sealed)),
    forgetPasskey: (accountId, credentialId) =>
      vaultService().then((vault) => vault.forgetPasskey(accountId, credentialId)),
    rotate: (accountId, request) =>
      vaultService().then((vault) => vault.rotate(accountId, request)),
    resealRecovery: (accountId, request) =>
      vaultService().then((vault) => vault.resealRecovery(accountId, request)),
    reset: (accountId) => vaultService().then((vault) => vault.reset(accountId)),
    sharingState: (accountId) => vaultService().then((vault) => vault.sharingState(accountId)),
    storeSharingState: (accountId, request) =>
      vaultService().then((vault) => vault.storeSharingState(accountId, request)),
    links: (accountId) => vaultService().then((vault) => vault.links(accountId)),
  },
  ...(documentStorage === undefined
    ? {}
    : {
        documents: {
          create: (accountId, request) =>
            documentService().then((documents) => documents.create(accountId, request)),
          presignUpload: (accountId, pathname) =>
            documentService().then((documents) => documents.presignUpload(accountId, pathname)),
          confirm: (accountId, documentId) =>
            documentService().then((documents) => documents.confirm(accountId, documentId)),
          list: (accountId, after) =>
            documentService().then((documents) => documents.list(accountId, after)),
          downloadUrl: (accountId, documentId) =>
            documentService().then((documents) => documents.downloadUrl(accountId, documentId)),
          replace: (accountId, request) =>
            documentService().then((documents) => documents.replace(accountId, request)),
          confirmReplacements: (accountId, documentIds) =>
            documentService().then((documents) =>
              documents.confirmReplacements(accountId, documentIds),
            ),
          delete: (accountId, documentIds) =>
            documentService().then((documents) => documents.delete(accountId, documentIds)),
        },
        ...(documentStorage.memory === undefined ? {} : { memoryObjects: documentStorage.memory }),
      }),
  cases: createCaseFiles({
    db: () => connected().db,
    audit: lazyAudit,
    today: () => new Date(),
    countries: pinnedCountries,
    evaluation: {
      catalog: routeCatalog,
      routeIds,
      comparisons: comparisonCatalog,
      states: () => knowledgeDecisions().states(),
      today: () => todayInSaoPaulo(),
      engineCommit: readEngineCommit(),
    },
  }),
  admins: createAdminGrants({
    db: () => connected().db,
    authDb: authConnection,
    role,
    stepUp: {
      spend: async (signedIn, purpose, action, record) =>
        (await authParts()).stepUp.spend(signedIn, purpose, action, record),
    },
    audit: lazyAudit,
    notify: async (accountId, kind) => (await authParts()).adminNotice(accountId, kind),
  }),
  knowledge: {
    decide: (signedIn, kind, target) => knowledgeDecisions().decide(signedIn, kind, target),
    states: () => knowledgeDecisions().states(),
  },
  ...(intake === undefined ? {} : { intake }),
  ruleReports: createRuleReportReview(() => connected().db),
  knowledgeVersions,
  ...(versionChecks === undefined ? {} : { versionChecks }),
  ...(ruleSummaries === undefined ? {} : { ruleSummaries }),
  accountConfirmed: (accountId) => accounts.isConfirmed(authConnection(), accountId),
  notifications: {
    channels: {
      list: (accountId) => notificationChannels().then((channels) => channels.list(accountId)),
      addPush: (accountId, subscription, device) =>
        notificationChannels().then((channels) =>
          channels.addPush(accountId, subscription, device),
        ),
      removePush: (accountId, channelId) =>
        notificationChannels().then((channels) => channels.removePush(accountId, channelId)),
      forgetPush: (accountId, subscription) =>
        notificationChannels().then((channels) => channels.forgetPush(accountId, subscription)),
    },
    pushKey,
  },
  ...(outbox === undefined ? {} : { outbox }),
  ...(tunnel === undefined ? {} : { tunnel }),
});

/**
 * The Nitro route for the API and the other paths that never fall back to the SPA (see
 * nitro.config.ts): unknown paths get the API's JSON 404.
 */
export default { fetch: (request: Request) => app.fetch(request) };
