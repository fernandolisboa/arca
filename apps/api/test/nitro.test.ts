import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { securityHeaders } from '@arca/security-policy';
import { build, copyPublicAssets, createNitro, prepare } from 'nitro/builder';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Builds the real nitro.config.ts, with apps/web's static build, so the tests see what deploys.
const rootDir = join(import.meta.dirname, '..');

async function buildWith(preset: string, outputDir: string) {
  const nitro = await createNitro({
    rootDir,
    dev: false,
    preset,
    logLevel: 0,
    output: { dir: outputDir },
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

describe('Vercel output', () => {
  it('applies the headers to static files and runs the function in gru1 on Node 26', async () => {
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

    const vcConfig = JSON.parse(
      await readFile(join(outputDir, 'functions', '__server.func', '.vc-config.json'), 'utf8'),
    ) as { regions: string[]; runtime: string };
    expect(vcConfig.regions).toEqual(['gru1']);
    expect(vcConfig.runtime).toBe('nodejs26.x');
  }, 120_000);
});
