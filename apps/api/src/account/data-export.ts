import { DataExport, dataExportSchemaVersion } from '@arca/api-contract/routes';
import { withIdentity, type Database, type Transaction } from '@arca/db';
import { registry as fullRegistry, type Registry, type RegistryEntry } from '@arca/db/registry';
import type { I18n } from '@arca/i18n';
import { sql, type SQL } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';

export interface DataExports {
  /** Everything the account owns, built on request and never stored (spec 0004, R8). */
  build(accountId: string): Promise<DataExport>;
}

export interface DataExportDependencies {
  /** The app_auth pool, the only one that reads the auth schema. */
  readonly authDb: Database;
  /** The app_api pool, which reads every other entry under the account's identity. */
  readonly apiDb: Database;
  readonly audit: AuditLog;
  readonly i18n: I18n;
  readonly registry?: Registry;
}

type Table = DataExport['tables'][number];

const inAuth = (entry: RegistryEntry) => entry.table.startsWith('auth.');

function qualified(table: string): SQL {
  const [schema = '', name = ''] = table.split('.');
  return sql`${sql.identifier(schema)}.${sql.identifier(name)}`;
}

const column = (alias: string, name: string) =>
  sql`${sql.identifier(alias)}.${sql.identifier(name)}`;

/**
 * The entry's projection as one JSON object per row, so timestamps come out in ISO 8601. A bytea
 * value is ciphertext or key material (spec 0005, R6): the export carries the placeholder instead
 * of any byte of it.
 */
function projection(entry: RegistryEntry, placeholder: string): SQL {
  const pairs = entry.export.map((name) => {
    const value = column('t', name);
    return sql`${name}::text, CASE WHEN pg_catalog.pg_typeof(${value}) = 'bytea'::pg_catalog.regtype
      THEN pg_catalog.to_jsonb(${placeholder}::text) ELSE pg_catalog.to_jsonb(${value}) END`;
  });
  return sql`pg_catalog.jsonb_build_object(${sql.join(pairs, sql`, `)})`;
}

/** The account's rows of the entry: by its owner column, or joined to its parent's. */
function owned(entry: RegistryEntry, registry: Registry, accountId: string): SQL {
  const { owner } = entry;
  const from = sql`FROM ${qualified(entry.table)} t`;
  if ('column' in owner) return sql`${from} WHERE ${column('t', owner.column)} = ${accountId}`;
  const parent = registry.entries.find((candidate) => candidate.table === owner.parent);
  if (parent === undefined || !('column' in parent.owner)) {
    throw new Error(`${entry.table} hangs off an entry not owned by a column`);
  }
  const keys = owner.columns.map(
    (name, index) => sql`${column('t', name)} = ${column('p', owner.parentColumns[index] ?? '')}`,
  );
  return sql`${from} JOIN ${qualified(parent.table)} p ON ${sql.join(keys, sql` AND `)}
    WHERE ${column('p', parent.owner.column)} = ${accountId}`;
}

export function createDataExports({
  authDb,
  apiDb,
  audit,
  i18n,
  registry = fullRegistry,
}: DataExportDependencies): DataExports {
  const placeholder = i18n.t('dataExport.masked');
  const read = async (tx: Transaction, entry: RegistryEntry, accountId: string) => {
    const result = await tx.execute<{ row: Table['rows'][number] }>(
      sql`SELECT ${projection(entry, placeholder)} AS row ${owned(entry, registry, accountId)} ORDER BY 1`,
    );
    return [entry.table, result.rows.map(({ row }) => row)] as const;
  };
  const readAll = async (tx: Transaction, entries: readonly RegistryEntry[], accountId: string) => {
    const tables = [];
    for (const entry of entries) tables.push(await read(tx, entry, accountId));
    return tables;
  };

  return {
    async build(accountId) {
      // One snapshot of the auth schema, so the parent and child rows agree.
      const { exportedAt, authTables } = await authDb.transaction(
        async (tx) => {
          const now = await tx.execute<{ at: string }>(
            sql`SELECT pg_catalog.to_jsonb(now()) AS at`,
          );
          return {
            exportedAt: now.rows[0]?.at ?? '',
            authTables: await readAll(tx, registry.entries.filter(inAuth), accountId),
          };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
      const otherTables = await withIdentity(apiDb, { accountId }, (tx) =>
        readAll(
          tx,
          registry.entries.filter((entry) => !inAuth(entry)),
          accountId,
        ),
      );
      const rows = new Map([...authTables, ...otherTables]);
      const document = DataExport.parse({
        schemaVersion: dataExportSchemaVersion,
        exportedAt,
        tables: registry.entries.map((entry) => ({
          table: entry.table,
          label: i18n.t(entry.label as never),
          rows: rows.get(entry.table) ?? [],
        })),
      });
      await audit.record({
        code: 'data_exported',
        subjectAccountId: accountId,
        actorAccountId: accountId,
        details: {},
      });
      return document;
    },
  };
}
