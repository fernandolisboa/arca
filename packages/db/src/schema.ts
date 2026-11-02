import { pgSchema } from 'drizzle-orm/pg-core';

// Drizzle definitions that drizzle-kit reads to generate SQL migrations into ./migrations, which
// the runner in tooling/scripts applies (spec 0001, R7). Every migration, the first one included,
// is generated so the snapshots stay in step with the database.
export const app = pgSchema('app');
