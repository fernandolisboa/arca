import {
  assertRole,
  createDatabase,
  createRolePool,
  roleStatus,
  type DatabaseTarget,
} from '@arca/db';
import type { CheckDatabase } from './database-health.js';

const role = 'app_api';

/**
 * The API's database: a pool that logs in as app_api with explicit fields and rejects any
 * connection running as another role. `ready` fails unless queries run as app_api, so the server
 * refuses to serve; `checkDatabase` backs `GET /v1/health`.
 */
export function apiDatabase(target: DatabaseTarget, password: string) {
  const pool = createRolePool(target, { role, password });
  const checkDatabase: CheckDatabase = () => roleStatus(pool, role);
  return {
    db: createDatabase(pool),
    checkDatabase,
    ready: () => assertRole(pool, role),
    close: () => pool.end(),
  };
}
