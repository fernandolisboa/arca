import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { securityHeaders } from '@arca/security-policy';
import { build, copyPublicAssets, createNitro, prepare } from 'nitro/builder';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Builds the real nitro.config.ts, with apps/web's static build, so the tests see what deploys.
// The one addition is a test route that throws outside the API's Hono app.
const rootDir = join(import.meta.dirname, '..');
const throwingPath = '/internal/test-throw';

async function buildWith(preset: string, outputDir: string) {
  const nitro = await createNitro({
    rootDir,
    dev: false,
    preset,
    logLevel: 0,
    output: { dir: outputDir },
    routes: { [throwingPath]: './test/fixtures/throwing-route.ts' },
    ...(preset === 'standard' ? { serveStatic: 'inline' as const } : {}),
  });
  await prepare(nitro);
  await copyPublicAssets(nitro);
  await build(nitro);
  await nitro.close();
}

let workDir: string;
let server: { fetch: (request: Request) => Promise<Response> };

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'arca-nitro-'));
  await buildWith('standard', join(workDir, 'standard'));
  const entry = pathToFileURL(join(workDir, 'standard', 'server', 'index.mjs')).href;
  // eslint-disable-next-line no-restricted-syntax -- the build output under test, at a temp path
  server = ((await import(entry)) as { default: typeof server }).default;
}, 120_000);

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const get = (path: string) => server.fetch(new Request(`https://arca.test${path}`));

function expectSecurityHeaders(response: Response) {
  for (const [name, value] of Object.entries(securityHeaders)) {
    expect(response.headers.get(name), name).toBe(value);
  }
}

describe('one origin (spec 0001, R4)', () => {
  it('serves the SPA with every security header', async () => {
    const response = await get('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await response.text()).toContain('<html lang="pt-BR">');
    expectSecurityHeaders(response);
  });

  it('serves the API with every security header and no-store', async () => {
    const response = await get('/v1/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'degraded',
      checks: { database: 'unavailable' },
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expectSecurityHeaders(response);
  });

  it.each(['/casos', '/casos/123/documentos', '/v10', '/internals', '/.well-knownx'])(
    'falls back to index.html for %s',
    async (path) => {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('<html lang="pt-BR">');
      expectSecurityHeaders(response);
    },
  );

  it.each([
    '/v1',
    '/v1/',
    '/v1/unknown',
    '/internal',
    '/internal/cron/unknown',
    '/.well-known',
    '/.well-known/unknown',
    '/.well-known/workflow/v1/unknown',
  ])('answers 404 with every security header for %s', async (path) => {
    const response = await get(path);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ error: { code: 'not_found' } });
    expectSecurityHeaders(response);
  });
});

describe('errors outside the API (spec 0001, R3 and R4)', () => {
  it.each(['/%', '/v1/%', '/casos/%'])(
    'answers a malformed path %s with every security header',
    async (path) => {
      const response = await get(path);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: 'request_failed' } });
      expect(response.headers.get('cache-control')).toBe('no-store');
      expectSecurityHeaders(response);
    },
  );

  it('answers a thrown error with every security header and logs no message', async () => {
    const written: string[] = [];
    const capture = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(capture);
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      written.push(args.map(String).join(' '));
    });
    try {
      const response = await get(throwingPath);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: { code: 'internal_error' } });
      expectSecurityHeaders(response);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      consoleError.mockRestore();
    }
    expect(written.join('\n')).not.toContain('synthetic detail');
    expect(written.map((line) => JSON.parse(line) as unknown)).toEqual([
      { level: 'error', status: 500, errorCode: 'internal_error', errorName: 'Error' },
    ]);
  });
});

describe('Vercel output', () => {
  it('applies the headers to static files and runs every function in gru1 on Node 26', async () => {
    const outputDir = join(workDir, 'vercel');
    await buildWith('vercel', outputDir);
    const config = JSON.parse(await readFile(join(outputDir, 'config.json'), 'utf8')) as {
      routes: { src?: string; headers?: Record<string, string>; handle?: string }[];
    };
    const filesystem = config.routes.findIndex((route) => route.handle === 'filesystem');
    const headers = config.routes.findIndex((route) => route.src === '/(.*)' && route.headers);
    expect(headers).toBeGreaterThanOrEqual(0);
    expect(headers).toBeLessThan(filesystem);
    expect(config.routes[headers]?.headers).toEqual(securityHeaders);

    const functionConfig = async (name: string) =>
      JSON.parse(await readFile(join(outputDir, 'functions', name, '.vc-config.json'), 'utf8')) as {
        regions: string[];
        runtime: string;
        experimentalTriggers?: { type: string }[];
      };
    for (const name of [
      '__server.func',
      '.well-known/workflow/v1/flow.func',
      '.well-known/workflow/v1/webhook/[token].func',
    ]) {
      const vcConfig = await functionConfig(name);
      expect(vcConfig.regions, name).toEqual(['gru1']);
      expect(vcConfig.runtime, name).toBe('nodejs26.x');
    }
    // The Workflow SDK's runner is a queue consumer, which Vercel keeps private: only the queue
    // invokes it (ADR-0009).
    const flow = await functionConfig('.well-known/workflow/v1/flow.func');
    expect(flow.experimentalTriggers?.map((trigger) => trigger.type)).toEqual(['queue/v2beta']);
  }, 120_000);
});
