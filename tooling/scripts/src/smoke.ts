import { securityHeaders } from '@arca/security-policy';
import { isRecord, reportViolations, type Violation } from './report.ts';

/**
 * The production smoke test (spec 0001, R9): the health check reports `ok` with the database
 * reached as the API's own role, and a page and the API both carry the security headers. It needs
 * no secret, since the production domain is public.
 */
export async function smokeTest(origin: URL, fetchUrl: typeof fetch = fetch): Promise<Violation[]> {
  const violations: Violation[] = [];
  const get = (path: string) => fetchUrl(new URL(path, origin), { redirect: 'manual' });

  const health = await get('/v1/health');
  if (health.status !== 200) {
    violations.push({ where: '/v1/health', problem: `answered ${String(health.status)}` });
  } else {
    const body: unknown = await health.json();
    const checks = isRecord(body) ? body['checks'] : undefined;
    const database = isRecord(checks) ? checks['database'] : undefined;
    if (!isRecord(body) || body['status'] !== 'ok' || database !== 'ok') {
      violations.push({
        where: '/v1/health',
        problem: `reported status ${String(isRecord(body) ? body['status'] : body)} and database ${String(database)}`,
      });
    }
  }

  for (const [path, response] of [
    ['/', await get('/')],
    ['/v1/health', health],
  ] as const) {
    for (const [name, expected] of Object.entries(securityHeaders)) {
      if (response.headers.get(name) !== expected) {
        violations.push({ where: path, problem: `header ${name} is missing or differs` });
      }
    }
  }
  return violations;
}

/** Usage: smoke.ts <https origin> */
if (import.meta.main) {
  const origin = new URL(process.argv[2] ?? '');
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search !== '') {
    throw new Error('usage: smoke.ts <https origin>');
  }
  reportViolations(await smokeTest(origin));
}
