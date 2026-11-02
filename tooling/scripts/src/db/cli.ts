import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bootstrap, renderBootstrap } from './bootstrap.ts';
import { buildTarget, requiredVariable } from './connection.ts';
import { readMigrations } from './migrations.ts';
import { environmentFor, migratorRole, readDatabasePolicy } from './policy.ts';
import { migrate } from './runner.ts';

const dbPackage = join(import.meta.dirname, '../../../../packages/db');

/** The build steps of spec 0001, R9: bootstrap as the owner, then migrations as app_migrator. */
async function main(command: string | undefined): Promise<void> {
  const env = process.env;
  if (command === 'bootstrap') {
    const target = buildTarget(env, {
      user: requiredVariable(env, 'PGUSER'),
      password: requiredVariable(env, 'PGPASSWORD'),
    });
    const template = await readFile(join(dbPackage, 'bootstrap.sql'), 'utf8');
    await bootstrap(
      target,
      renderBootstrap(template, {
        app_migrator: requiredVariable(env, 'ARCA_DB_MIGRATOR_PASSWORD'),
        app_api: requiredVariable(env, 'ARCA_DB_API_PASSWORD'),
        app_jobs: requiredVariable(env, 'ARCA_DB_JOBS_PASSWORD'),
      }),
    );
    console.log('roles bootstrapped');
    return;
  }
  if (command === 'migrate') {
    const target = buildTarget(env, {
      user: migratorRole,
      password: requiredVariable(env, 'ARCA_DB_MIGRATOR_PASSWORD'),
    });
    const policy = await readDatabasePolicy(join(dbPackage, 'policy'), environmentFor(target.host));
    const { applied } = await migrate(
      target,
      await readMigrations(join(dbPackage, 'migrations')),
      policy,
    );
    console.log(
      `${String(applied.length)} migrations applied${applied.length > 0 ? `: ${applied.join(', ')}` : ''}`,
    );
    return;
  }
  throw new Error('usage: cli.ts bootstrap | migrate');
}

if (import.meta.main) await main(process.argv[2]);
