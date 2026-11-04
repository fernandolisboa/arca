import {
  assertRole,
  createDatabase,
  createRolePool,
  roleStatus,
  type DatabaseTarget,
  type RuntimeRole,
} from '@arca/db';
import type { CheckDatabase } from './database-health.js';
import type { Logger } from './logger.js';

/**
 * A service's database: a pool that logs in as `role` with explicit fields and rejects any
 * connection running as another role or with a preset identity, and logs a dropped idle
 * connection instead of crashing. `checkDatabase` backs `GET /v1/health`; `ready` fails unless
 * queries run as `role`.
 */
export function roleDatabase(
  role: RuntimeRole,
  target: DatabaseTarget,
  password: string,
  logger: Logger,
) {
  const pool = createRolePool(
    target,
    { role, password },
    // The error's class name only: its message may carry connection details.
    {
      onIdleError: (error) => {
        logger.error({ errorName: error.name });
      },
    },
  );
  const checkDatabase: CheckDatabase = () => roleStatus(pool, role);
  return {
    db: createDatabase(pool),
    checkDatabase,
    ready: () => assertRole(pool, role),
    close: () => pool.end(),
  };
}

/** The API's database, as app_api. */
export const apiDatabase = (target: DatabaseTarget, password: string, logger: Logger) =>
  roleDatabase('app_api', target, password, logger);

/** The audit log's writer, as app_audit: it may only insert audit events (spec 0003, R7). */
export const auditDatabase = (target: DatabaseTarget, password: string, logger: Logger) =>
  roleDatabase('app_audit', target, password, logger);

/** Better Auth's database, as app_auth: the only role with access to the auth schema. */
export const authDatabase = (target: DatabaseTarget, password: string, logger: Logger) =>
  roleDatabase('app_auth', target, password, logger);
