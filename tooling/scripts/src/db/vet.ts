import { parse } from 'libpg-query';
import { isRecord } from '../report.ts';

export interface VettedMigration {
  /** Each top-level statement's text, in order, as the parser split them. */
  readonly statements: readonly string[];
  readonly problems: readonly string[];
}

const transactionControl = 'TransactionStmt';
const roleStatements = new Set([
  'CreateRoleStmt',
  'AlterRoleStmt',
  'AlterRoleSetStmt',
  'DropRoleStmt',
  'GrantRoleStmt',
  'AlterDatabaseSetStmt',
  'AlterSystemStmt',
  'ReassignOwnedStmt',
]);

/** Every node of a parse tree, with its node type when it has one. */
function* walk(value: unknown): Generator<[string | undefined, Record<string, unknown>]> {
  if (Array.isArray(value)) {
    for (const item of value) yield* walk(item);
    return;
  }
  if (!isRecord(value)) return;
  const keys = Object.keys(value);
  const nodeType = keys.length === 1 && /^[A-Z]/.test(keys[0] ?? '') ? keys[0] : undefined;
  yield [nodeType, value];
  for (const child of Object.values(value)) yield* walk(child);
}

function problemsIn(statement: Record<string, unknown>, allowedExtensions: readonly string[]) {
  const problems = new Set<string>();
  const [kind] = Object.keys(statement);
  if (kind === transactionControl) problems.add('controls the transaction');
  if (kind === 'VariableSetStmt') problems.add('changes a setting or role (SET or RESET)');
  if (kind !== undefined && roleStatements.has(kind))
    problems.add('changes roles or role settings');
  if (kind === 'CreateExtensionStmt') {
    const body = statement[kind];
    const name = isRecord(body) ? body['extname'] : undefined;
    if (typeof name !== 'string' || !allowedExtensions.includes(name)) {
      problems.add(`creates extension ${String(name)}, which is not allowed`);
    }
  }
  for (const [nodeType, node] of walk(statement)) {
    const body = nodeType === undefined ? node : node[nodeType];
    if (!isRecord(body)) continue;
    if (body['concurrent'] === true) problems.add('uses CONCURRENTLY');
    if (nodeType === 'DefElem' && body['defname'] === 'concurrently') {
      problems.add('uses CONCURRENTLY');
    }
    if (nodeType === 'DefElem' && body['defname'] === 'password') problems.add('sets a password');
    if (body['relpersistence'] === 't') problems.add('creates a temporary object');
  }
  return [...problems];
}

/**
 * Splits a migration into statements with the Postgres parser and rejects what a migration must
 * never do (spec 0001, R7). This is defence in depth: dynamic SQL in a DO block passes it, so the
 * runner's transaction checks and the guards are the authoritative layer.
 */
export async function vetMigration(
  sql: string,
  allowedExtensions: readonly string[],
): Promise<VettedMigration> {
  const { stmts = [] } = await parse(sql);
  const bytes = Buffer.from(sql, 'utf8');
  const statements: string[] = [];
  const problems: string[] = [];
  for (const [index, raw] of stmts.entries()) {
    const start = raw.stmt_location ?? 0;
    const end =
      raw.stmt_len === undefined || raw.stmt_len === 0 ? bytes.length : start + raw.stmt_len;
    const text = bytes.subarray(start, end).toString('utf8').trim();
    statements.push(text);
    const statement: unknown = raw.stmt;
    if (!isRecord(statement)) {
      problems.push(`statement ${String(index + 1)} could not be read`);
      continue;
    }
    for (const problem of problemsIn(statement, allowedExtensions)) {
      problems.push(`statement ${String(index + 1)} ${problem}`);
    }
  }
  if (statements.length === 0) problems.push('has no statements');
  return { statements, problems };
}
