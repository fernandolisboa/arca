import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { build, copyPublicAssets, createNitro, prepare } from 'nitro/builder';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The heartbeat end to end on the SDK's local world (spec 0001, R6): the real Nitro build, the
// cron route, the queue, and the step reaching a disposable Postgres server as app_jobs.
const host = process.env['ARCA_TEST_DB_HOST'] ?? '127.0.0.1';
const adminUser = process.env['ARCA_TEST_DB_ADMIN_USER'] ?? 'postgres';
const adminPassword = process.env['ARCA_TEST_DB_ADMIN_PASSWORD'] ?? '';
if (adminPassword === '') throw new Error('ARCA_TEST_DB_ADMIN_PASSWORD is not set');
// The API connects on 5432, the only port its build-time configuration knows.
if ((process.env['ARCA_TEST_DB_PORT'] ?? '5432') !== '5432') {
  throw new Error('the heartbeat test needs Postgres on port 5432');
}

const rootDir = join(import.meta.dirname, '..', '..');
const database = `arca_heartbeat_${randomBytes(6).toString('hex')}`;
const jobsPassword = randomBytes(24).toString('base64url');
const cronSecret = randomBytes(24).toString('base64url');

async function asAdmin(name: string, statements: readonly string[]): Promise<void> {
  const client = new pg.Client({
    host,
    port: 5432,
    database: name,
    user: adminUser,
    password: adminPassword,
    ssl: false,
  });
  await client.connect();
  try {
    for (const statement of statements) await client.query(statement);
  } finally {
    await client.end();
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address !== null) resolve(address.port);
        else reject(new Error('no port'));
      });
    });
  });
}

let workDir: string | undefined;
let dataDir: string;
let origin: string;
let server: ChildProcess | undefined;
let createdRole = false;

beforeAll(async () => {
  await asAdmin('postgres', [`CREATE DATABASE ${database}`]);
  const client = new pg.Client({
    host,
    port: 5432,
    database: 'postgres',
    user: adminUser,
    password: adminPassword,
    ssl: false,
  });
  await client.connect();
  try {
    const exists = await client.query("SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_jobs'");
    createdRole = exists.rowCount === 0;
    await client.query(
      `${createdRole ? 'CREATE' : 'ALTER'} ROLE app_jobs LOGIN PASSWORD '${jobsPassword}'`,
    );
  } finally {
    await client.end();
  }

  const dir = await mkdtemp(join(tmpdir(), 'arca-heartbeat-'));
  workDir = dir;
  dataDir = join(dir, 'workflow-data');
  const outputDir = join(dir, 'output');
  const nitro = await createNitro({
    rootDir,
    dev: false,
    preset: 'node-server',
    logLevel: 0,
    output: { dir: outputDir },
    runtimeConfig: { database: { host, name: database } },
  });
  await prepare(nitro);
  await copyPublicAssets(nitro);
  await build(nitro);
  await nitro.close();

  const port = await freePort();
  origin = `http://127.0.0.1:${String(port)}`;
  server = spawn(process.execPath, [join(outputDir, 'server', 'index.mjs')], {
    env: {
      PATH: process.env['PATH'] ?? '',
      HOST: '127.0.0.1',
      PORT: String(port),
      CRON_SECRET: cronSecret,
      ARCA_DB_JOBS_PASSWORD: jobsPassword,
      WORKFLOW_LOCAL_DATA_DIR: dataDir,
    },
    stdio: 'ignore',
  });
  for (let attempt = 0; ; attempt += 1) {
    const ready = await fetch(`${origin}/v1/health`).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) break;
    if (attempt === 50) throw new Error('the built server did not start');
    await sleep(100);
  }
});

afterAll(async () => {
  server?.kill();
  await asAdmin('postgres', [
    `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`,
    ...(createdRole ? ['DROP ROLE app_jobs'] : []),
  ]);
  if (workDir !== undefined) await rm(workDir, { recursive: true, force: true });
});

interface StoredRecord {
  readonly status: string;
  readonly input?: unknown;
  readonly attributes?: Record<string, string>;
}

async function records(kind: 'runs' | 'steps'): Promise<StoredRecord[]> {
  const directory = join(dataDir, kind);
  const entries = await readdir(directory, { recursive: true }).catch(() => []);
  return Promise.all(
    entries
      .filter((entry) => entry.endsWith('.json'))
      .map(
        async (entry) => JSON.parse(await readFile(join(directory, entry), 'utf8')) as StoredRecord,
      ),
  );
}

describe('heartbeat on the local world', () => {
  it('runs from the cron route to a completed step as app_jobs, keeping no input', async () => {
    const response = await fetch(`${origin}/internal/cron/heartbeat`, {
      headers: { authorization: `Bearer ${cronSecret}` },
    });
    expect(response.status).toBe(202);

    let runs: StoredRecord[] = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      runs = await records('runs');
      if (runs.length === 1 && ['completed', 'failed'].includes(runs[0]?.status ?? '')) break;
      await sleep(200);
    }
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'completed', attributes: { $retention: '0' } });
    expect(runs[0]).not.toHaveProperty('input');
    expect((await records('steps')).map((step) => step.status)).toEqual(['completed']);
  });
});
