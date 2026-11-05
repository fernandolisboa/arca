import type pg from 'pg';
import type { Environment } from './connection.ts';
import { environmentFor } from './policy.ts';

export type Deployment = 'production' | 'preview';

const endpointPattern = /^ep-[a-z0-9-]+$/;

/**
 * The Vercel deployment a build step serves (spec 0001, R9), from the variables Vercel sets in
 * every build. Outside Vercel there is none, and then the target must not be Neon: the hosted
 * databases are changed only by Vercel builds.
 */
export function deploymentFor(env: Environment, host: string): Deployment | undefined {
  if (env['VERCEL'] !== '1') {
    if (environmentFor(host) === 'neon') {
      throw new Error('only a Vercel build may bootstrap or migrate a Neon database');
    }
    return undefined;
  }
  if (environmentFor(host) !== 'neon' || !endpointPattern.test(endpointOf(host))) {
    throw new Error('a Vercel build must reach a Neon endpoint');
  }
  if (env['VERCEL_ENV'] !== 'production') return 'preview';
  if (env['VERCEL_GIT_COMMIT_REF'] !== 'main') {
    throw new Error('a production build must come from main');
  }
  return 'production';
}

/** A Neon host's first label is its endpoint ID, with `-pooler` on the pooled host. */
export function endpointOf(host: string): string {
  return (host.split('.')[0] ?? '').replace(/-pooler$/, '').toLowerCase();
}

const markerPrefix = 'arca production endpoint: ';

/**
 * Decides from the database's comment whether a build may change this database. The first
 * production build writes its endpoint there; preview branches fork from production and so carry
 * the mark, but each has an endpoint of its own. A preview build that reaches the marked endpoint,
 * or a database with no mark, is refused: the injected variables would then name production.
 */
export function markToWrite(
  deployment: Deployment,
  endpoint: string,
  comment: string | null,
): string | undefined {
  const marked = comment?.startsWith(markerPrefix) ? comment.slice(markerPrefix.length) : undefined;
  if (deployment === 'production') {
    if (marked === undefined) return `${markerPrefix}${endpoint}`;
    if (marked !== endpoint) {
      throw new Error('this production build reaches a database marked for another endpoint');
    }
    return undefined;
  }
  if (marked === undefined) {
    throw new Error('a preview build needs a branch of the marked production database');
  }
  if (marked === endpoint) throw new Error('a preview build reaches the production database');
  return undefined;
}

/**
 * Checks the mark inside the caller's transaction. The bootstrap, as the database owner, writes it
 * on the first production build; the migrator only reads it, so it refuses an unmarked database.
 */
export async function checkDeploymentTarget(
  client: pg.Client,
  deployment: Deployment,
  host: string,
  { mayMark }: { readonly mayMark: boolean },
): Promise<void> {
  const { rows } = await client.query<{ name: string; comment: string | null }>(
    `SELECT d.datname AS name, pg_catalog.shobj_description(d.oid, 'pg_database') AS comment
       FROM pg_catalog.pg_database d WHERE d.datname = pg_catalog.current_database()`,
  );
  const database = rows[0];
  if (database === undefined) throw new Error('the current database is not in pg_database');
  const mark = markToWrite(deployment, endpointOf(host), database.comment);
  if (mark !== undefined) {
    if (!mayMark) throw new Error('the database is not marked; the bootstrap marks it first');
    await client.query(
      `COMMENT ON DATABASE ${client.escapeIdentifier(database.name)} IS ${client.escapeLiteral(mark)}`,
    );
  }
}

const lineageMark = 'arca lineage: production';

/** A preview build reached a database forked from production after the lineage mark (spec 0004, R1). */
export class PreviewForkedFromProduction extends Error {
  readonly code = 'preview_forked_from_production';

  constructor() {
    super(
      'preview_forked_from_production: this preview database carries production rows; point Preview at development or rebuild it (spec 0004 R1)',
    );
  }
}

/**
 * Production writes the lineage mark on the runner's schema, which every later fork inherits; a
 * preview that finds it is refused before any migration runs. Called inside the runner's
 * transaction, after its advisory lock and once the schema exists, as its owner app_migrator.
 */
export async function checkLineage(client: pg.Client, deployment: Deployment): Promise<void> {
  const { rows } = await client.query<{ comment: string | null }>(
    `SELECT pg_catalog.obj_description(n.oid, 'pg_namespace') AS comment
       FROM pg_catalog.pg_namespace n WHERE n.nspname = 'arca_migrations'`,
  );
  const marked = rows[0]?.comment === lineageMark;
  if (deployment === 'preview') {
    if (marked) throw new PreviewForkedFromProduction();
    return;
  }
  if (!marked) {
    await client.query(`COMMENT ON SCHEMA arca_migrations IS ${client.escapeLiteral(lineageMark)}`);
  }
}
