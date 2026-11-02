import { setTimeout as sleep } from 'node:timers/promises';
import { securityHeaders } from '@arca/security-policy';
import { isRecord, reportViolations, type Violation } from './report.ts';

export interface SmokeOptions {
  readonly fetchUrl?: typeof fetch;
  /** Health checks before giving up: a cold function or a suspended database can fail the first. */
  readonly attempts?: number;
  /** Longer than the API's 10-second cache of a failed database check. */
  readonly retryDelayMs?: number;
}

/**
 * The production smoke test (spec 0001, R9): the health check reports `ok` with the database
 * reached as the API's own role, the web app answers, and both carry the security headers. It
 * needs no secret, since the production domain is public.
 */
export async function smokeTest(
  origin: URL,
  { fetchUrl = fetch, attempts = 6, retryDelayMs = 15_000 }: SmokeOptions = {},
): Promise<Violation[]> {
  const get = (path: string) => fetchUrl(new URL(path, origin), { redirect: 'manual' });

  let health = await get('/v1/health');
  let problem = await healthProblem(health);
  for (let attempt = 1; attempt < attempts && problem !== undefined; attempt += 1) {
    await sleep(retryDelayMs);
    health = await get('/v1/health');
    problem = await healthProblem(health);
  }
  const violations: Violation[] = problem === undefined ? [] : [{ where: '/v1/health', problem }];

  const page = await get('/');
  if (page.status !== 200 || !(page.headers.get('content-type') ?? '').startsWith('text/html')) {
    violations.push({
      where: '/',
      problem: `answered ${String(page.status)} ${page.headers.get('content-type') ?? ''}`,
    });
  }

  for (const [path, response] of [
    ['/', page],
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

async function healthProblem(response: Response): Promise<string | undefined> {
  if (response.status !== 200) return `answered ${String(response.status)}`;
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return 'answered with a body that is not JSON';
  }
  const checks = isRecord(body) ? body['checks'] : undefined;
  const database = isRecord(checks) ? checks['database'] : undefined;
  const status = isRecord(body) ? body['status'] : undefined;
  if (status === 'ok' && database === 'ok') return undefined;
  return `reported status ${String(status)} and database ${String(database)}`;
}

/** Usage: smoke.ts <https origin> */
if (import.meta.main) {
  const origin = new URL(process.argv[2] ?? '');
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search !== '') {
    throw new Error('usage: smoke.ts <https origin>');
  }
  reportViolations(await smokeTest(origin));
}
