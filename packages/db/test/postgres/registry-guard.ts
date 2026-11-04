import type { ClientBase } from 'pg';
import type { Registry, RegistryEntry } from '../../src/registry.js';

/** What the guard reads from the catalog after migrations. */
export interface Catalog {
  /** `schema.table` for every table in a user schema. */
  readonly tables: readonly string[];
  /** Per table, each column's name and its quoted form, as policies are deparsed with it. */
  readonly columns: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly foreignKeys: readonly ForeignKey[];
  readonly policies: readonly Policy[];
}

export interface ForeignKey {
  readonly name: string;
  readonly table: string;
  readonly references: string;
  /** `pg_constraint.confdeltype`: `c` cascade, `n` set null, `d` set default, `a`/`r` none. */
  readonly onDelete: string;
}

export interface Policy {
  readonly table: string;
  readonly name: string;
  /** `pg_policy.polcmd`: `r` select, `d` delete, `*` all, and so on. */
  readonly command: string;
  readonly permissive: boolean;
  /** Whether the policy applies to `app_jobs`, directly or through PUBLIC. */
  readonly forJobs: boolean;
  readonly qualifier: string | null;
}

const userSchemas = `n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'`;
const qualified = `n.nspname || '.' || c.relname`;

export async function readCatalog(client: Pick<ClientBase, 'query'>): Promise<Catalog> {
  const tables = await client.query<{ name: string }>(
    `SELECT ${qualified} AS name
       FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND ${userSchemas}`,
  );
  const columns = await client.query<{ name: string; column: string; quoted: string }>(
    `SELECT ${qualified} AS name, a.attname AS column, pg_catalog.quote_ident(a.attname) AS quoted
       FROM pg_catalog.pg_attribute a
       JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND ${userSchemas} AND a.attnum > 0 AND NOT a.attisdropped`,
  );
  const foreignKeys = await client.query<ForeignKey>(
    `SELECT k.conname AS name, ${qualified} AS table,
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
  const byTable = new Map<string, Map<string, string>>();
  for (const { name, column, quoted } of columns.rows) {
    const known = byTable.get(name) ?? new Map<string, string>();
    known.set(column, quoted);
    byTable.set(name, known);
  }
  return {
    tables: tables.rows.map((row) => row.name),
    columns: byTable,
    foreignKeys: foreignKeys.rows,
    policies: policies.rows,
  };
}

const schemaOf = (table: string) => table.slice(0, table.indexOf('.'));

/** The only qualifier an `app_jobs` erase policy may have (spec 0001 R7, ADR-0017). */
export const identityQualifier = (quotedColumn: string) =>
  `(${quotedColumn} = (NULLIF(current_setting('app.account_id'::text, true), ''::text))::uuid)`;

function entryProblems(entry: RegistryEntry, catalog: Catalog, entries: Set<string>): string[] {
  const { table } = entry;
  const columns = catalog.columns.get(table);
  if (columns === undefined) return [];
  const problems: string[] = [];
  const ownerColumn = 'column' in entry.owner ? entry.owner.column : undefined;
  for (const column of [...(ownerColumn === undefined ? [] : [ownerColumn]), ...entry.export]) {
    if (!columns.has(column)) problems.push(`${table} has no column ${column}`);
  }
  const inAuth = schemaOf(table) === 'auth';
  if (inAuth && !(entry.strategy === 'delete' && entry.pool === 'app_auth')) {
    problems.push(`${table} is in auth but is not deleted by app_auth`);
  }
  if (!inAuth && entry.strategy === 'delete' && entry.pool !== 'app_jobs') {
    problems.push(`${table} is outside auth but is not deleted by app_jobs`);
  }
  if ('parent' in entry.owner) {
    const { parent } = entry.owner;
    if (!entries.has(parent)) problems.push(`${table} hangs off ${parent}, which is not an entry`);
    const cascades = catalog.foreignKeys.some(
      (key) => key.table === table && key.references === parent && key.onDelete === 'c',
    );
    if (!cascades) problems.push(`${table} has no ON DELETE CASCADE foreign key to ${parent}`);
  }
  if (entry.strategy === 'delete' && entry.pool === 'app_jobs' && ownerColumn !== undefined) {
    const expected = identityQualifier(columns.get(ownerColumn) ?? ownerColumn);
    const jobs = (commands: string) =>
      catalog.policies.filter(
        (policy) =>
          policy.table === table &&
          policy.permissive &&
          policy.forJobs &&
          commands.includes(policy.command),
      );
    const deletes = jobs('d*');
    if (deletes.length === 0) problems.push(`${table} has no app_jobs DELETE policy`);
    for (const policy of deletes.filter((policy) => policy.qualifier !== expected)) {
      problems.push(`${table} policy ${policy.name} lets app_jobs delete beyond the identity`);
    }
    if (!jobs('r*').some((policy) => policy.qualifier === expected)) {
      problems.push(`${table} has no app_jobs SELECT policy on the identity`);
    }
  }
  return problems;
}

/**
 * Every table has one lifecycle decision and every decision holds against the catalog (spec 0004
 * R7). Returns the problems, sorted; none means the registry is complete.
 */
export function checkRegistry(catalog: Catalog, registry: Registry): string[] {
  const listed = [...registry.entries, ...registry.unowned].map((item) => item.table);
  const entries = new Set(registry.entries.map((entry) => entry.table));
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
    ...registry.entries.flatMap((entry) => entryProblems(entry, catalog, entries)),
  ];
  return [...new Set(problems)].sort();
}
