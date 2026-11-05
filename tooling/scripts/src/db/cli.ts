import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bootstrap, renderBootstrap } from './bootstrap.ts';
import { buildTarget, requiredVariable } from './connection.ts';
import { deploymentFor } from './deployment-target.ts';
import { readMigrations } from './migrations.ts';
import { environmentFor, migratorRole, readDatabasePolicy } from './policy.ts';
import { migrate } from './runner.ts';
import { readSeedAccounts, seed, seedRole } from './seed.ts';
import { writeRuntimeDatabaseConfig } from './runtime-config.ts';

const dbPackage = join(import.meta.dirname, '../../../../packages/db');
const apiDatabaseConfig = join(import.meta.dirname, '../../../../apps/api/generated/database.json');

/**
 * The build steps of spec 0001, R9: bootstrap as the owner, migrations as app_migrator, the
 * synthetic seed as app_auth outside production (spec 0004, R2), and the API's build-time database
 * settings.
 */
async function main(command: string | undefined): Promise<void> {
  const env = process.env;
  if (command === 'bootstrap') {
    const target = buildTarget(env, {
      user: requiredVariable(env, 'PGUSER'),
      password: requiredVariable(env, 'PGPASSWORD'),
    });
    const deployment = deploymentFor(env, target.host);
    const template = await readFile(join(dbPackage, 'bootstrap.sql'), 'utf8');
    await bootstrap(
      target,
      renderBootstrap(template, {
        app_migrator: requiredVariable(env, 'ARCA_DB_MIGRATOR_PASSWORD'),
        app_api: requiredVariable(env, 'ARCA_DB_API_PASSWORD'),
        app_jobs: requiredVariable(env, 'ARCA_DB_JOBS_PASSWORD'),
        app_auth: requiredVariable(env, 'ARCA_DB_AUTH_PASSWORD'),
        app_audit: requiredVariable(env, 'ARCA_DB_AUDIT_PASSWORD'),
      }),
      deployment,
    );
    console.log('roles bootstrapped');
    return;
  }
  if (command === 'migrate') {
    const target = buildTarget(env, {
      user: migratorRole,
      password: requiredVariable(env, 'ARCA_DB_MIGRATOR_PASSWORD'),
    });
    const deployment = deploymentFor(env, target.host);
    const policy = await readDatabasePolicy(join(dbPackage, 'policy'), environmentFor(target.host));
    const { applied } = await migrate(
      target,
      await readMigrations(join(dbPackage, 'migrations')),
      policy,
      deployment,
    );
    console.log(
      `${String(applied.length)} migrations applied${applied.length > 0 ? `: ${applied.join(', ')}` : ''}`,
    );
    return;
  }
  if (command === 'seed') {
    const deployment = deploymentFor(env, requiredVariable(env, 'PGHOST_UNPOOLED'));
    if (deployment === 'production') {
      console.log('no seed in production');
      return;
    }
    const target = buildTarget(env, {
      user: seedRole,
      password: requiredVariable(env, 'ARCA_DB_AUTH_PASSWORD'),
    });
    const accounts = await readSeedAccounts(join(dbPackage, 'seed/accounts.json'));
    await seed(target, accounts, deployment);
    console.log(`synthetic seed applied: ${String(accounts.length)} accounts`);
    return;
  }
  if (command === 'runtime-config') {
    await writeRuntimeDatabaseConfig(env, apiDatabaseConfig);
    console.log('API database settings written');
    return;
  }
  throw new Error('usage: cli.ts bootstrap | migrate | seed | runtime-config');
}

if (import.meta.main) await main(process.argv[2]);
