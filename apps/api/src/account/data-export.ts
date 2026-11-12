import { DataExport, dataExportSchemaVersion } from '@arca/api-contract/routes';
import { withIdentity, type Database, type Transaction } from '@arca/db';
import {
  registry as fullRegistry,
  parentLinks,
  type ParentLink,
  type Registry,
  type RegistryEntry,
} from '@arca/db/registry';
import type { I18n } from '@arca/i18n';
import { sql, type SQL } from 'drizzle-orm';
import type { AuditLog } from '../audit/log.js';
import { type CaseRows, readCase } from '../case/view.js';
import { namesAccount } from './erasure.js';

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
 * of any byte of it. A JSON value, such as a profile's facts, comes out as its JSON text, and a
 * 64-bit integer or a numeric, such as an asset's amount or an owner's share, as its decimal text,
 * so no reader rounds it. The registry guard allows exactly these types.
 */
function projection(entry: RegistryEntry, placeholder: string): SQL {
  const pairs = entry.export.map((name) => {
    const value = column('t', name);
    const type = sql`pg_catalog.pg_typeof(${value})`;
    return sql`${name}::text, CASE WHEN ${type} = 'pg_catalog.bytea'::pg_catalog.regtype
      THEN pg_catalog.to_jsonb(${placeholder}::text)
      WHEN ${type} IN ('pg_catalog.jsonb'::pg_catalog.regtype, 'pg_catalog.int8'::pg_catalog.regtype,
        'pg_catalog.numeric'::pg_catalog.regtype) THEN pg_catalog.to_jsonb(${value}::text)
      ELSE pg_catalog.to_jsonb(${value}) END`;
  });
  return sql`pg_catalog.jsonb_build_object(${sql.join(pairs, sql`, `)})`;
}

/** `alias.columns` equal `otherAlias.otherColumns`, pairwise. */
function sameKeys(
  alias: string,
  columns: readonly string[],
  otherAlias: string,
  otherColumns: readonly string[],
): SQL {
  const pairs = columns.map(
    (name, index) => sql`${column(alias, name)} = ${column(otherAlias, otherColumns[index] ?? '')}`,
  );
  return sql.join(pairs, sql` AND `);
}

/**
 * Whether the entry's row `alias` is the account's: by its owner columns, through any of its
 * parents, or through the rows that reference it, each reached by its own foreign key.
 */
function ownedBy(entry: RegistryEntry, registry: Registry, accountId: string, alias: string): SQL {
  const { owner } = entry;
  const entryOf = (table: string) => {
    const found = registry.entries.find((candidate) => candidate.table === table);
    if (found === undefined) throw new Error(`${entry.table} is owned through ${table}, unlisted`);
    return found;
  };
  const next = `${alias}_`;
  if ('referencedBy' in owner) {
    const referencing = entryOf(owner.referencedBy);
    return sql`EXISTS (SELECT FROM ${qualified(referencing.table)} ${sql.identifier(next)}
      WHERE ${sameKeys(next, owner.referencingColumns, alias, owner.columns)}
        AND ${ownedBy(referencing, registry, accountId, next)})`;
  }
  const links = parentLinks(owner);
  if (links.length === 0) return sql`(${namesAccount(entry, accountId, alias)})`;
  const throughParent = (link: ParentLink) => {
    const parent = entryOf(link.parent);
    return sql`EXISTS (SELECT FROM ${qualified(parent.table)} ${sql.identifier(next)}
      WHERE ${sameKeys(alias, link.columns, next, link.parentColumns)}
        AND ${ownedBy(parent, registry, accountId, next)})`;
  };
  return sql`(${sql.join(links.map(throughParent), sql` OR `)})`;
}

/** The account's rows of the entry, as a `FROM … WHERE` clause over alias `t`. */
export function ownedRows(entry: RegistryEntry, registry: Registry, accountId: string): SQL {
  return sql`FROM ${qualified(entry.table)} t WHERE ${ownedBy(entry, registry, accountId, 't')}`;
}

/** The case's people and relationships as the account sees them, by name (spec 0007, R9). */
function seenCase(rows: CaseRows): NonNullable<DataExport['case']> {
  const names = new Map(rows.people.map((person) => [person.id, person.displayName]));
  return {
    people: rows.people.map(({ displayName, caseMember, keptByMe }) => ({
      displayName,
      caseMember,
      keptByMe,
    })),
    relationships: rows.relationships.map(({ kind, from, to, details }) => ({
      kind,
      from: names.get(from) ?? '',
      to: names.get(to) ?? '',
      details: JSON.stringify(details),
    })),
  };
}

export function createDataExports({
  authDb,
  apiDb,
  audit,
  i18n,
  registry = fullRegistry,
}: DataExportDependencies): DataExports {
  const placeholder = i18n.t('dataExport.masked');
  const rowsOf = (entry: RegistryEntry, accountId: string) =>
    entry.exportedThrough === undefined
      ? sql`SELECT ${projection(entry, placeholder)} AS row ${ownedRows(entry, registry, accountId)} ORDER BY 1`
      : sql`SELECT row FROM ${qualified(entry.exportedThrough)}(${entry.table}) row ORDER BY 1`;
  const read = async (tx: Transaction, entry: RegistryEntry, accountId: string) => {
    const result = await tx.execute<{ row: Table['rows'][number] }>(rowsOf(entry, accountId));
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
      const { otherTables, seen } = await withIdentity(apiDb, { accountId }, async (tx) => {
        const caseRows = await readCase(tx, accountId);
        return {
          otherTables: await readAll(
            tx,
            registry.entries.filter((entry) => !inAuth(entry)),
            accountId,
          ),
          seen: caseRows === undefined ? null : seenCase(caseRows),
        };
      });
      const rows = new Map([...authTables, ...otherTables]);
      const document = DataExport.parse({
        schemaVersion: dataExportSchemaVersion,
        exportedAt,
        tables: registry.entries.map((entry) => ({
          table: entry.table,
          label: i18n.t(entry.label as never),
          rows: rows.get(entry.table) ?? [],
        })),
        case: seen,
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
