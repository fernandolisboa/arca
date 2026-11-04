import type { ClientBase } from 'pg';
import type { Registry, RegistryEntry } from '../../src/registry.js';

/** What the guard reads from the catalog after migrations. */
export interface Catalog {
  /** `schema.table` for every table in a user schema. */
  readonly tables: readonly string[];
  /** Tables with row-level security enabled and forced. */
  readonly forcedRls: ReadonlySet<string>;
  /** Per table, each column's quoted form (as policies are deparsed with it) and nullability. */
  readonly columns: ReadonlyMap<string, ReadonlyMap<string, Column>>;
  readonly foreignKeys: readonly ForeignKey[];
  readonly policies: readonly Policy[];
}

export interface Column {
  readonly quoted: string;
  readonly notNull: boolean;
  /** `pg_type.typname`, so a domain or an array shows as itself, not as its base type. */
  readonly type: string;
}

export interface ForeignKey {
  readonly name: string;
  readonly table: string;
  /** The referencing columns, in key order. */
  readonly columns: readonly string[];
  readonly references: string;
  /** The referenced columns, in key order. */
  readonly referencedColumns: readonly string[];
  /** `pg_constraint.confdeltype`: `c` cascade, `n` set null, `d` set default, `a`/`r` none. */
  readonly onDelete: string;
}

export interface Policy {
  readonly table: string;
  readonly name: string;
  /** `pg_policy.polcmd`: `r` select, `d` delete, `*` all, and so on. */
  readonly command: string;
  readonly permissive: boolean;
  /** Whether the policy names `app_jobs` or PUBLIC. */
  readonly forJobs: boolean;
  readonly qualifier: string | null;
}

const userSchemas = `n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'`;
const qualified = `n.nspname || '.' || c.relname`;

export async function readCatalog(client: Pick<ClientBase, 'query'>): Promise<Catalog> {
  const tables = await client.query<{ name: string; forced: boolean }>(
    `SELECT ${qualified} AS name, c.relrowsecurity AND c.relforcerowsecurity AS forced
       FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND ${userSchemas}`,
  );
  const columns = await client.query<{ name: string; column: string } & Column>(
    `SELECT ${qualified} AS name, a.attname AS column, pg_catalog.quote_ident(a.attname) AS quoted,
            a.attnotnull AS "notNull", t.typname AS type
       FROM pg_catalog.pg_attribute a
       JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
       JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND ${userSchemas} AND a.attnum > 0 AND NOT a.attisdropped`,
  );
  const foreignKeys = await client.query<ForeignKey>(
    `SELECT k.conname AS name, ${qualified} AS table,
            ARRAY(SELECT a.attname::text FROM pg_catalog.unnest(k.conkey) WITH ORDINALITY AS key(attnum, position)
                    JOIN pg_catalog.pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = key.attnum
                   ORDER BY key.position) AS columns,
            ARRAY(SELECT a.attname::text FROM pg_catalog.unnest(k.confkey) WITH ORDINALITY AS key(attnum, position)
                    JOIN pg_catalog.pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = key.attnum
                   ORDER BY key.position) AS "referencedColumns",
            rn.nspname || '.' || r.relname AS "references", k.confdeltype AS "onDelete"
       FROM pg_catalog.pg_constraint k
       JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_catalog.pg_class r ON r.oid = k.confrelid
       JOIN pg_catalog.pg_namespace rn ON rn.oid = r.relnamespace
      WHERE k.contype = 'f'`,
  );
  const policies = await client.query<Policy>(
    `SELECT ${qualified} AS table, p.polname AS name, p.polcmd AS command,
            p.polpermissive AS permissive,
            (0::oid = ANY (p.polroles)
              OR EXISTS (SELECT FROM pg_catalog.pg_roles j
                          WHERE j.rolname = 'app_jobs' AND j.oid = ANY (p.polroles))) AS "forJobs",
            pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS qualifier
       FROM pg_catalog.pg_policy p
       JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace`,
  );
  const byTable = new Map<string, Map<string, Column>>();
  for (const { name, column, quoted, notNull, type } of columns.rows) {
    const known = byTable.get(name) ?? new Map<string, Column>();
    known.set(column, { quoted, notNull, type });
    byTable.set(name, known);
  }
  return {
    tables: tables.rows.map((row) => row.name),
    forcedRls: new Set(tables.rows.filter((row) => row.forced).map((row) => row.name)),
    columns: byTable,
    foreignKeys: foreignKeys.rows,
    policies: policies.rows,
  };
}

/**
 * The types an export projection may carry: scalars the contract's values hold, plus `bytea`,
 * which the export always masks. A domain, an array or JSON would slip past the mask or the
 * contract, so it fails here instead of in an export.
 */
const exportableTypes = new Set([
  'text',
  'varchar',
  'bool',
  'int2',
  'int4',
  'uuid',
  'date',
  'timestamptz',
  'bytea',
]);

const schemaOf = (table: string) => table.slice(0, table.indexOf('.'));
const sameColumns = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((column, index) => column === b[index]);

/**
 * The only qualifier an `app_jobs` erase policy may have (spec 0001 R7, ADR-0017). Compared as
 * Postgres deparses it, so a change in that form fails the guard rather than passing it.
 */
export const identityQualifier = (quotedColumn: string) =>
  `(${quotedColumn} = (NULLIF(current_setting('app.account_id'::text, true), ''::text))::uuid)`;

function jobsErasureProblems(table: string, ownerColumn: Column, catalog: Catalog): string[] {
  const problems: string[] = [];
  if (!catalog.forcedRls.has(table)) {
    problems.push(`${table} does not have row-level security enabled and forced`);
  }
  const expected = identityQualifier(ownerColumn.quoted);
  const jobs = catalog.policies.filter(
    (policy) => policy.table === table && policy.forJobs && 'rd*'.includes(policy.command),
  );
  const permissive = (commands: string) =>
    jobs.filter((policy) => policy.permissive && commands.includes(policy.command));
  const deletes = permissive('d*');
  if (deletes.length === 0) problems.push(`${table} has no app_jobs DELETE policy`);
  for (const policy of deletes.filter((policy) => policy.qualifier !== expected)) {
    problems.push(`${table} policy ${policy.name} lets app_jobs delete beyond the identity`);
  }
  if (!permissive('r*').some((policy) => policy.qualifier === expected)) {
    problems.push(`${table} has no app_jobs SELECT policy on the identity`);
  }
  // A restrictive policy narrows the erasure, which then leaves rows behind without an error.
  for (const policy of jobs.filter((policy) => !policy.permissive)) {
    problems.push(`${table} policy ${policy.name} is restrictive and narrows the erasure`);
  }
  return problems;
}

function entryProblems(entry: RegistryEntry, catalog: Catalog, registry: Registry): string[] {
  const { table, owner } = entry;
  const columns = catalog.columns.get(table);
  if (columns === undefined) return [];
  const problems: string[] = [];
  const ownerColumns = 'column' in owner ? [owner.column] : owner.columns;
  for (const column of [...ownerColumns, ...entry.export]) {
    if (!columns.has(column)) problems.push(`${table} has no column ${column}`);
  }
  for (const column of entry.export) {
    const type = columns.get(column)?.type;
    if (type !== undefined && !exportableTypes.has(type)) {
      problems.push(`${table}.${column} has type ${type}, which the export cannot carry`);
    }
  }
  for (const column of ownerColumns) {
    // A row with no owner belongs to nobody, so no erasure would ever reach it.
    if (columns.get(column)?.notNull === false) problems.push(`${table}.${column} can be null`);
  }
  const inAuth = schemaOf(table) === 'auth';
  if (inAuth && !(entry.strategy === 'delete' && entry.pool === 'app_auth')) {
    problems.push(`${table} is in auth but is not deleted by app_auth`);
  }
  if (!inAuth && entry.strategy === 'delete' && entry.pool !== 'app_jobs') {
    problems.push(`${table} is outside auth but is not deleted by app_jobs`);
  }
  if ('parent' in owner) {
    const parent = registry.entries.find((candidate) => candidate.table === owner.parent);
    if (parent?.strategy !== 'delete' || !('column' in parent.owner)) {
      problems.push(
        `${table} hangs off ${owner.parent}, which is not a deleted entry owned by a column`,
      );
    }
    const cascades = catalog.foreignKeys.some(
      (key) =>
        key.table === table &&
        key.references === owner.parent &&
        key.onDelete === 'c' &&
        sameColumns(key.columns, owner.columns) &&
        sameColumns(key.referencedColumns, owner.parentColumns),
    );
    if (!cascades) {
      problems.push(
        `${table} has no ON DELETE CASCADE foreign key (${owner.columns.join(', ')}) to ${owner.parent} (${owner.parentColumns.join(', ')})`,
      );
    }
  } else if (entry.strategy === 'delete' && entry.pool === 'app_jobs') {
    const ownerColumn = columns.get(owner.column);
    if (ownerColumn !== undefined)
      problems.push(...jobsErasureProblems(table, ownerColumn, catalog));
  }
  return problems;
}

/**
 * Every table has one lifecycle decision and every decision holds against the catalog (spec 0004
 * R7). Returns the problems, sorted; none means the registry is complete.
 */
export function checkRegistry(catalog: Catalog, registry: Registry): string[] {
  const listed = [...registry.entries, ...registry.unowned].map((item) => item.table);
  const tables = new Set(catalog.tables);
  const problems = [
    ...catalog.tables
      .filter((table) => !listed.includes(table))
      .map((table) => `${table} has no registry decision`),
    ...listed
      .filter((table, index) => listed.indexOf(table) !== index)
      .map((table) => `${table} is listed more than once`),
    ...listed
      .filter((table) => !tables.has(table))
      .map((table) => `${table} is in the registry but does not exist`),
    ...registry.unowned.flatMap((item) =>
      item.personalData === 'until-expiry' &&
      tables.has(item.table) &&
      catalog.columns.get(item.table)?.has(item.expiresAt) !== true
        ? [`${item.table} has no column ${item.expiresAt}`]
        : [],
    ),
    ...catalog.foreignKeys
      .filter((key) => schemaOf(key.table) === 'audit')
      .map((key) => `foreign key ${key.name} on ${key.table} leaves audit`),
    ...catalog.foreignKeys
      .filter(
        (key) =>
          (schemaOf(key.table) === 'auth') !== (schemaOf(key.references) === 'auth') &&
          'cnd'.includes(key.onDelete),
      )
      .map((key) => `foreign key ${key.name} on ${key.table} cascades across the auth schema`),
    ...registry.entries.flatMap((entry) => entryProblems(entry, catalog, registry)),
  ];
  return [...new Set(problems)].sort();
}
