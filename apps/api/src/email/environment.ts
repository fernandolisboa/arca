import type { Database } from '@arca/db';
import { hostNamePattern, readResendKey, type DeploymentEnvironment } from '../config.js';
import { productionSite, type ProductionSite } from '../production-site.js';
import { unconfiguredSender, type EmailSender } from './email.js';
import { outboxSender, readOutbox, type OutboxEntry } from './outbox.js';
import { resendSender } from './resend.js';

/** Where an environment's email goes (spec 0003, R8). */
export type EmailRoute =
  | { readonly via: 'outbox' }
  | { readonly via: 'resend'; readonly apiKey: string; readonly from: string }
  | { readonly via: 'none' };

/**
 * Every environment but production writes to the outbox; production sends through Resend once
 * the site file names its host and sending domain and the key is set, and sends nothing before
 * (spec 0003, R9). Read once at startup.
 */
export function emailRouteFor(
  environment: DeploymentEnvironment,
  site: ProductionSite = productionSite,
  apiKey: string | undefined = readResendKey(),
): EmailRoute {
  if (environment !== 'production') return { via: 'outbox' };
  const { host, senderDomain } = site;
  if (host === null || senderDomain === null || apiKey === undefined) return { via: 'none' };
  if (!hostNamePattern.test(senderDomain)) return { via: 'none' };
  return { via: 'resend', apiKey, from: `Arca <no-reply@${senderDomain}>` };
}

/**
 * New accounts need email: enrollment, invites and recovery all prove an address with a link, so
 * without a way to send one they stay closed (spec 0003, R9).
 */
export const accountsOpenWith = (route: EmailRoute): boolean => route.via !== 'none';

/** The sender for the route; the database is opened on the first outbox message. */
export function emailSenderFor(
  route: EmailRoute,
  environment: DeploymentEnvironment,
  db: () => Database,
): EmailSender {
  switch (route.via) {
    case 'none':
      return unconfiguredSender;
    case 'resend':
      return resendSender({ apiKey: route.apiKey, from: route.from });
    case 'outbox':
      return { send: (message) => outboxSender(db(), environment).send(message) };
  }
}

/** The reader behind `/internal/outbox`, which exists on previews only (spec 0003, R8). */
export function outboxReaderFor(
  environment: DeploymentEnvironment,
  db: () => Database,
): (() => Promise<OutboxEntry[]>) | undefined {
  if (environment !== 'preview') return undefined;
  return () => readOutbox(db(), environment);
}
