import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

export function createDatabase(pool: pg.Pool) {
  return drizzle({ client: pool });
}

export type Database = ReturnType<typeof createDatabase>;

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
