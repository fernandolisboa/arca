import type { DeploymentEnvironment } from '../config.js';

/** The synthetic seed account (packages/db/seed), an owner wherever the seed is the data. */
const seedAccountId = '00000000-5eed-4000-8000-000000000001';

/** The owner's production account. */
const ownerAccountId = '2cdd34cb-535a-42d1-be81-0e5c65cea476';

/**
 * The owner list (ADR-0027): the accounts that are always admins, per environment, changed only by
 * a reviewed pull request. An account it names cannot lose the role in the app; it is how the
 * first admin exists. Production lists the owner's account.
 */
export const ownerList: Readonly<Record<DeploymentEnvironment, readonly string[]>> = {
  production: [ownerAccountId],
  preview: [seedAccountId],
  development: [seedAccountId],
};
