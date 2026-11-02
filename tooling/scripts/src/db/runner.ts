import type pg from 'pg';
import { clientFor, type ConnectionTarget } from './connection.ts';
import { runGuards, type GuardViolation } from './guards.ts';
import { pendingMigrations, type JournalRow, type MigrationFile } from './migrations.ts';
import type { DatabasePolicy } from './policy.ts';
import { vetMigration } from './vet.ts';

export interface MigrationResult {
  readonly applied: readonly string[];
}

export class MigrationRejected extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`migration rejected: ${problems.join('; ')}`);
    this.problems = problems;
  }
}

export const migratorRole = 'app_migrator';
// A fixed key, so two runs on the same database cannot interleave.
const advisoryLockKey = 4_174_523_011;

const journalTable = 'arca_migrations.journal';

async function readJournal(client: pg.Client): Promise<JournalRow[]> {
  const result = await client.query<JournalRow>(
    `SELECT name, checksum FROM ${journalTable} ORDER BY name`,
  );
  return result.rows;
}

/** Checks that only the runner can satisfy: they cover what a DO block can do past the parser. */
async function transactionChecks(
  client: pg.Client,
  transactionId: string,
  expectedJournal: readonly JournalRow[],
): Promise<string[]> {
  const problems: string[] = [];
  const identity = await client.query<{ current: string; session: string; xid: string }>(
    `SELECT pg_catalog.current_user() AS current, pg_catalog.session_user() AS session,
            pg_catalog.pg_current_xact_id()::text AS xid`,
  );
  const row = identity.rows[0];
  if (row?.current !== migratorRole || row.session !== migratorRole) {
    problems.push(
      `ran as ${String(row?.current)} (session ${String(row?.session)}), not ${migratorRole}`,
    );
  }
  if (row?.xid !== transactionId) problems.push('the transaction ended inside a migration');

  const temporary = await client.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_catalog.pg_class c
      WHERE c.relnamespace = pg_catalog.pg_my_temp_schema()
     UNION ALL
     SELECT p.proname FROM pg_catalog.pg_proc p
      WHERE p.pronamespace = pg_catalog.pg_my_temp_schema()`,
  );
  for (const { name } of temporary.rows) problems.push(`created temporary object ${name}`);

  // Any role change (CREATE, ALTER … PASSWORD or SET, GRANT of a role) writes these catalogs and so
  // holds a lock stronger than the AccessShareLock a read takes.
  const roleWrites = await client.query<{ name: string }>(
    `SELECT l.relation::pg_catalog.regclass::text AS name FROM pg_catalog.pg_locks l
      WHERE l.pid = pg_catalog.pg_backend_pid() AND l.locktype = 'relation'
        AND l.mode <> 'AccessShareLock'
        AND l.relation IN ('pg_catalog.pg_authid'::pg_catalog.regclass,
                           'pg_catalog.pg_auth_members'::pg_catalog.regclass,
                           'pg_catalog.pg_db_role_setting'::pg_catalog.regclass)`,
  );
  for (const { name } of roleWrites.rows) problems.push(`changed roles (wrote ${name})`);

  const journal = await readJournal(client);
  if (JSON.stringify(journal) !== JSON.stringify(expectedJournal)) {
    problems.push(
      'the journal does not equal its state before the run plus the applied migrations',
    );
  }
  const journalShape = await client.query<{ problem: string }>(
    `SELECT problem FROM (
       SELECT 'the journal table has row-level security on' AS problem
         FROM pg_catalog.pg_class c WHERE c.oid = '${journalTable}'::pg_catalog.regclass AND c.relrowsecurity
       UNION ALL
       SELECT 'the journal table has a trigger' FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = '${journalTable}'::pg_catalog.regclass
       UNION ALL
       SELECT 'the journal table has a rule' FROM pg_catalog.pg_rewrite r
        WHERE r.ev_class = '${journalTable}'::pg_catalog.regclass
       UNION ALL
       SELECT 'the journal table has a policy' FROM pg_catalog.pg_policy p
        WHERE p.polrelid = '${journalTable}'::pg_catalog.regclass
     ) found`,
  );
  problems.push(...journalShape.rows.map((found) => found.problem));
  return problems;
}

/**
 * Applies pending migrations as app_migrator in one transaction that commits only if the
 * transaction checks and guards 1 to 8 pass (spec 0001, R7). Throws MigrationRejected otherwise,
 * after rolling everything back.
 */
export async function migrate(
  target: ConnectionTarget,
  files: readonly MigrationFile[],
  policy: DatabasePolicy,
): Promise<MigrationResult> {
  if (target.user !== migratorRole) throw new Error(`the runner connects as ${migratorRole}`);
  const vetting: string[] = [];
  const statements = new Map<string, readonly string[]>();
  for (const file of files) {
    const vetted = await vetMigration(file.sql, policy.guards.migrationExtensions);
    statements.set(file.name, vetted.statements);
    vetting.push(...vetted.problems.map((problem) => `${file.name}: ${problem}`));
  }
  if (vetting.length > 0) throw new MigrationRejected(vetting);

  const client = clientFor(target);
  await client.connect();
  try {
    await client.query('BEGIN');
    try {
      const applied = await applyInTransaction(client, files, statements, policy);
      await client.query('COMMIT');
      return { applied };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end();
  }
}

async function applyInTransaction(
  client: pg.Client,
  files: readonly MigrationFile[],
  statements: ReadonlyMap<string, readonly string[]>,
  policy: DatabasePolicy,
): Promise<string[]> {
  await client.query('SELECT pg_catalog.pg_advisory_xact_lock($1)', [advisoryLockKey]);
  const transaction = await client.query<{ xid: string }>(
    'SELECT pg_catalog.pg_current_xact_id()::text AS xid',
  );
  const transactionId = transaction.rows[0]?.xid ?? '';
  await client.query('CREATE SCHEMA IF NOT EXISTS arca_migrations');
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${journalTable} (
       name text PRIMARY KEY,
       checksum text NOT NULL,
       applied_at timestamptz NOT NULL DEFAULT pg_catalog.now()
     )`,
  );
  const before = await readJournal(client);
  const plan = pendingMigrations(files, before);
  if ('problem' in plan) throw new MigrationRejected([plan.problem]);

  for (const file of plan.pending) {
    for (const statement of statements.get(file.name) ?? []) await client.query(statement);
    await client.query(`INSERT INTO ${journalTable} (name, checksum) VALUES ($1, $2)`, [
      file.name,
      file.checksum,
    ]);
  }
  // Right after the last statement, before anything else reads a name.
  await client.query('SET LOCAL search_path = pg_catalog, pg_temp');
  await client.query('RESET ROLE');

  const expected = [...before, ...plan.pending.map(({ name, checksum }) => ({ name, checksum }))];
  const problems = await transactionChecks(client, transactionId, expected);
  const violations: GuardViolation[] = await runGuards(client, policy);
  problems.push(...violations.map(({ guard, problem }) => `guard ${String(guard)}: ${problem}`));
  if (problems.length > 0) throw new MigrationRejected(problems);
  return plan.pending.map((file) => file.name);
}
