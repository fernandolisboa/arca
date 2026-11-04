import { auditReader } from './audit/log.js';
import { clientAddressFor } from './client-address.js';
import { readAuthOrigin, readCronSecret } from './config.js';
import { outboxReaderFor } from './email/environment.js';
import { createApp } from './app.js';
import {
  accountsOpen,
  authConnection,
  authParts,
  connected,
  environment,
  limiter,
  logger,
} from './services.js';
import { heartbeat } from './workflows/heartbeat.js';
import { startWorkflow } from './workflows/start-workflow.js';

/**
 * Read once at load, but a missing setting only refuses state-changing requests (the auth routes
 * then fail and log it), so `GET /v1/health` and the static shell keep answering.
 */
function ownOrigin(): string | undefined {
  try {
    return readAuthOrigin();
  } catch {
    return undefined;
  }
}

const withOrigin = (origin: string | undefined) => (origin === undefined ? {} : { origin });

const outbox = outboxReaderFor(environment, authConnection);

const app = createApp({
  checkDatabase: () => connected().checkDatabase(),
  logger,
  cron: {
    readSecret: readCronSecret,
    startHeartbeat: (runDate) => startWorkflow(heartbeat, [runDate]),
    sweepRateLimits: () => limiter.sweep(),
  },
  ...withOrigin(ownOrigin()),
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
    revokePasskey: async (signedIn, passkeyId) =>
      (await authParts()).devices.revokePasskey(signedIn, passkeyId),
    revokeOtherSessions: async (signedIn) =>
      (await authParts()).devices.revokeOtherSessions(signedIn),
    addOptions: async (signedIn) => (await authParts()).devices.addOptions(signedIn),
    add: async (signedIn, challengeId, response) =>
      (await authParts()).devices.add(signedIn, challengeId, response),
    status: async (accountId) => (await authParts()).devices.status(accountId),
  },
  recovery: {
    start: async (email) => (await authParts()).recovery.start(email),
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
  ...(outbox === undefined ? {} : { outbox }),
});

/**
 * The Nitro route for the API and the other paths that never fall back to the SPA (see
 * nitro.config.ts): unknown paths get the API's JSON 404.
 */
export default { fetch: (request: Request) => app.fetch(request) };
