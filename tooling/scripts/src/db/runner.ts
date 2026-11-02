import pg from 'pg';
import { clientFor, type ConnectionTarget } from './connection.ts';
import { runGuards, type GuardViolation } from './guards.ts';
import { pendingMigrations, type JournalRow, type MigrationFile } from './migrations.ts';
import { migratorRole, type DatabasePolicy } from './policy.ts';
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

// A fixed key, so two runs on the same database cannot interleave.
const advisoryLockKey = 4_174_523_011;

const journalTable = 'arca_migrations.journal';

const pinnedSearchPath = 'pg_catalog, pg_temp';

/**
 * The journal exactly as the runner creates it. Anything a migration attached could run its code
 * when the journal is written or planned (a default, constraint, index expression or predicate,
 * statistics expression, child table), so the shape is checked before the journal is read.
 */
const journalShapeQuery = `
  WITH journal AS (SELECT '${journalTable}'::pg_catalog.regclass AS oid)
  SELECT problem FROM (
    SELECT 'the journal is not a plain table without row-level security' AS problem
      FROM pg_catalog.pg_class c JOIN journal j ON c.oid = j.oid
     WHERE c.relkind <> 'r' OR c.relrowsecurity OR c.relforcerowsecurity
    UNION ALL
    SELECT 'the journal table has a trigger' FROM pg_catalog.pg_trigger t JOIN journal j ON t.tgrelid = j.oid
    UNION ALL
    SELECT 'the journal table has a rule' FROM pg_catalog.pg_rewrite r JOIN journal j ON r.ev_class = j.oid
    UNION ALL
    SELECT 'the journal table has a policy' FROM pg_catalog.pg_policy p JOIN journal j ON p.polrelid = j.oid
    UNION ALL
    SELECT 'the journal table has unexpected columns'
     WHERE (SELECT pg_catalog.string_agg(a.attname || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
              FROM pg_catalog.pg_attribute a JOIN journal j ON a.attrelid = j.oid
             WHERE a.attnum > 0 AND NOT a.attisdropped)
           IS DISTINCT FROM 'name text, checksum text, applied_at timestamp with time zone'
    UNION ALL
    SELECT 'the journal table has an unexpected default'
     WHERE (SELECT pg_catalog.string_agg(pg_catalog.pg_get_expr(d.adbin, d.adrelid), ', ')
              FROM pg_catalog.pg_attrdef d JOIN journal j ON d.adrelid = j.oid)
           IS DISTINCT FROM 'now()'
    UNION ALL
    SELECT 'the journal table has an unexpected constraint'
      FROM pg_catalog.pg_constraint k JOIN journal j ON k.conrelid = j.oid
     WHERE k.contype NOT IN ('p', 'n')
    UNION ALL
    SELECT 'the journal table has an index other than its plain primary key'
     WHERE (SELECT pg_catalog.count(*) FROM pg_catalog.pg_index i JOIN journal j ON i.indrelid = j.oid) <> 1
        OR NOT EXISTS (SELECT FROM pg_catalog.pg_index i JOIN journal j ON i.indrelid = j.oid
                        WHERE i.indisprimary AND i.indkey::text = '1'
                          AND i.indexprs IS NULL AND i.indpred IS NULL)
    UNION ALL
    SELECT 'the journal table has inheritance' FROM pg_catalog.pg_inherits h JOIN journal j
        ON h.inhrelid = j.oid OR h.inhparent = j.oid
    UNION ALL
    SELECT 'the journal table has extended statistics' FROM pg_catalog.pg_statistic_ext x
      JOIN journal j ON x.stxrelid = j.oid
  ) found`;

async function readJournal(client: pg.Client): Promise<JournalRow[]> {
  const result = await client.query<JournalRow>(
    `SELECT name, checksum FROM ONLY ${journalTable} ORDER BY name COLLATE "C"`,
  );
  return result.rows;
}

/** Checks that only the runner can satisfy: they cover what a DO block can do past the parser. */
async function transactionChecks(
  client: pg.Client,
  expectedJournal: readonly JournalRow[],
): Promise<string[]> {
  const problems: string[] = [];
  // The shape is checked before the journal is read, so reading it runs no migration code.
  const journalShape = await client.query<{ problem: string }>(journalShapeQuery);
  problems.push(...journalShape.rows.map((found) => found.problem));
  if (journalShape.rows.length === 0) {
    const journal = await readJournal(client);
    if (JSON.stringify(journal) !== JSON.stringify(expectedJournal)) {
      problems.push(
        'the journal does not equal its state before the run plus the applied migrations',
      );
    }
  }

  const temporary = await client.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_catalog.pg_class c
      WHERE c.relnamespace = pg_catalog.pg_my_temp_schema()
     UNION ALL
     SELECT p.proname FROM pg_catalog.pg_proc p
      WHERE p.pronamespace = pg_catalog.pg_my_temp_schema()
     UNION ALL
     SELECT t.typname FROM pg_catalog.pg_type t
      WHERE t.typnamespace = pg_catalog.pg_my_temp_schema()
     UNION ALL
     SELECT o.oprname FROM pg_catalog.pg_operator o
      WHERE o.oprnamespace = pg_catalog.pg_my_temp_schema()`,
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

  // A WITH HOLD cursor would run its query at COMMIT, after the guards; rejecting rolls it back
  // unrun. The runner's own unnamed portal is listed with an empty name.
  const cursors = await client.query<{ name: string }>(
    `SELECT name FROM pg_catalog.pg_cursors WHERE name <> ''`,
  );
  for (const { name } of cursors.rows) problems.push(`left cursor ${name} open`);
  return problems;
}

/**
 * Runs after the guards: if any migration code had run after the pin, the search path or the role
 * would show it.
 */
async function identityChecks(client: pg.Client, transactionId: string): Promise<string[]> {
  const problems: string[] = [];
  const identity = await client.query<{
    current: string;
    session: string;
    xid: string;
    searchPath: string;
  }>(
    `SELECT pg_catalog.current_user() AS current, pg_catalog.session_user() AS session,
            pg_catalog.pg_current_xact_id()::text AS xid,
            pg_catalog.current_setting('search_path') AS "searchPath"`,
  );
  const row = identity.rows[0];
  if (row?.searchPath !== pinnedSearchPath) {
    problems.push(`search_path is ${String(row?.searchPath)} during the checks`);
  }
  if (row?.current !== migratorRole || row.session !== migratorRole) {
    problems.push(
      `ran as ${String(row?.current)} (session ${String(row?.session)}), not ${migratorRole}`,
    );
  }
  if (row?.xid !== transactionId) problems.push('the transaction ended inside a migration');

  return problems;
}

/**
 * Applies pending migrations as app_migrator in one transaction that commits only if the
 * transaction checks and guards 1 to 9 pass (spec 0001, R7). Throws MigrationRejected otherwise,
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
  // A migration blocked behind live traffic fails fast instead of holding its locks until the
  // build times out. Set after the advisory lock, so a second build still waits for the first.
  await client.query("SET LOCAL lock_timeout = '30s'");
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
    for (const statement of statements.get(file.name) ?? []) {
      // The extended protocol runs exactly one command per call. The simple protocol would run
      // every command the server finds in the text, and a migration that changes how the server
      // lexes (standard_conforming_strings off) could hide a COMMIT from the parser that vetted it.
      // @types/pg does not declare queryMode, which node-postgres 8 supports.
      const query: pg.QueryConfig & { queryMode: 'extended' } = {
        text: statement,
        queryMode: 'extended',
      };
      await client.query(query);
    }
  }
  for (const file of plan.pending) {
    await client.query(`INSERT INTO ${journalTable} (name, checksum) VALUES ($1, $2)`, [
      file.name,
      file.checksum,
    ]);
  }
  // From here on the runner reads only built-in catalogs and a journal whose shape it checks first,
  // so no migration code runs; the identity check confirms the pin still holds. What would run at
  // COMMIT, after the guards, is rejected instead: a deferrable trigger or constraint (guard 9), a
  // WITH HOLD cursor (the cursor check) and any pending trigger event (the final probe).
  await client.query(`SET LOCAL search_path = ${pinnedSearchPath}`);
  await client.query("SET LOCAL client_encoding = 'UTF8'");
  await client.query('RESET ROLE');

  const expected = [...before, ...plan.pending.map(({ name, checksum }) => ({ name, checksum }))];
  const problems = await transactionChecks(client, expected);
  const violations: GuardViolation[] = await runGuards(client, policy);
  problems.push(...violations.map(({ guard, problem }) => `guard ${String(guard)}: ${problem}`));
  problems.push(...(await identityChecks(client, transactionId)));
  if (problems.length > 0) throw new MigrationRejected(problems);
  // Last, because a table with pending events aborts the transaction.
  await rejectPendingTriggerEvents(client);
  return plan.pending.map((file) => file.name);
}

const objectInUse = '55006';
const insufficientPrivilege = '42501';

/**
 * Proves the after-trigger queue is empty, so nothing deferred runs at COMMIT. Guard 9 reads the
 * catalogs, but an event keeps the deferrability it had when it was queued, and ALTER CONSTRAINT
 * on a foreign key can clear the catalog flag of an event already pending on another table, a
 * partition or a partitioned parent (a row moving between partitions queues its event there).
 * ALTER TABLE refuses any table with pending events before it changes anything. The subcommands
 * are no-ops that take a ShareUpdateExclusiveLock: a plain table re-marks the index already
 * clustered (or none), and a partitioned table, which cannot hold storage parameters, resets one.
 */
async function rejectPendingTriggerEvents(client: pg.Client): Promise<void> {
  const tables = await client.query<{ statement: string }>(
    `SELECT pg_catalog.format('ALTER TABLE ONLY %I.%I %s', n.nspname, c.relname,
              CASE WHEN c.relkind = 'p' THEN 'RESET (fillfactor)'
                   ELSE coalesce('CLUSTER ON ' || pg_catalog.quote_ident(clustered.relname),
                                 'SET WITHOUT CLUSTER') END) AS statement
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN LATERAL (
         SELECT ic.relname FROM pg_catalog.pg_index i
           JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
          WHERE i.indrelid = c.oid AND i.indisclustered) clustered ON true
      WHERE c.relkind IN ('r', 'p') AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
      ORDER BY 1`,
  );
  for (const { statement } of tables.rows) {
    try {
      await client.query(statement);
    } catch (error) {
      if (error instanceof pg.DatabaseError && error.code === objectInUse) {
        throw new MigrationRejected([`trigger events would run at COMMIT: ${error.message}`]);
      }
      if (error instanceof pg.DatabaseError && error.code === insufficientPrivilege) {
        throw new MigrationRejected([
          `cannot check for pending trigger events, because ${migratorRole} does not own every table: ${error.message}`,
        ]);
      }
      throw error;
    }
  }
}
