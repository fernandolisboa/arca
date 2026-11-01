import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { reportViolations, type Violation } from './report.ts';

/** Server-only modules that must never reach the client bundle (spec 0001, R2). */
const forbiddenModule = /(?:^|\/)node_modules\/(hono|@hono\/zod-openapi)\//;

/**
 * Reads the source maps Vite writes next to the bundle and lists every bundled module from a
 * forbidden package. With no source maps there is nothing to verify, which is itself a failure.
 */
export async function checkWebBundle(distDir: string): Promise<Violation[]> {
  const files = await readdir(distDir, { recursive: true });
  const maps = files.filter((file) => file.endsWith('.js.map'));
  if (maps.length === 0) {
    return [{ where: distDir, problem: 'no source maps found; the bundle cannot be verified' }];
  }
  const violations: Violation[] = [];
  for (const map of maps) {
    const { sources } = JSON.parse(await readFile(join(distDir, map), 'utf8')) as {
      sources?: unknown;
    };
    if (!Array.isArray(sources)) {
      violations.push({ where: map, problem: 'source map has no sources list' });
      continue;
    }
    for (const source of sources) {
      if (typeof source === 'string' && forbiddenModule.test(source)) {
        violations.push({ where: map, problem: `bundles server-only module ${source}` });
      }
    }
  }
  return violations;
}

if (import.meta.main) {
  reportViolations(await checkWebBundle(process.argv[2] ?? 'apps/web/dist'));
}
