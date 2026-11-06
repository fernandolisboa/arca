import type { DeploymentEnvironment } from '../config.js';

/** The synthetic seed account (packages/db/seed), the approver wherever the seed is the data. */
const seedAccountId = '00000000-5eed-4000-8000-000000000001';

/**
 * The approver list (spec 0007, R7; ADR-0022): the accounts that may activate or reject route
 * versions, per environment, changed only by a reviewed pull request. Production lists the owner's
 * account once it exists there; until then nobody can activate a version in production.
 */
export const approvers: Readonly<Record<DeploymentEnvironment, readonly string[]>> = {
  production: [],
  preview: [seedAccountId],
  development: [seedAccountId],
};
