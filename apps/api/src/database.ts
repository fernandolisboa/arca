import {
  assertRole,
  createDatabase,
  createRolePool,
  roleStatus,
  type DatabaseTarget,
} from '@arca/db';
import type { CheckDatabase } from './database-health.js';
import type { Logger } from './logger.js';

const role = 'app_api';

/**
 * The API's database: a pool that logs in as app_api with explicit fields and rejects any
 * connection running as another role or with a preset identity, and logs a dropped idle
 * connection instead of crashing. `checkDatabase` backs `GET /v1/health`; `ready` fails unless
 * queries run as app_api, for a deploy check to call before traffic moves (#14).
 */
export function apiDatabase(target: DatabaseTarget, password: string, logger: Logger) {
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
