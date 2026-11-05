import { setTimeout as sleep } from 'node:timers/promises';
import { securityHeaders } from '@arca/security-policy';
import { isRecord, reportViolations, type Violation } from './report.ts';

const workflowRunnerPath = '/.well-known/workflow/v1/flow';
const workflowWebhookPath = '/.well-known/workflow/v1/webhook/';
const securityTxtPath = '/.well-known/security.txt';
const dayMs = 24 * 60 * 60 * 1000;
/** security.txt is renewed at least this long before it expires (spec 0004, R11). */
const renewalDays = 30;
/** How the platform refuses a request to a private function. */
const platformRejections: ReadonlySet<number> = new Set([401, 403, 404]);

export interface SmokeOptions {
  readonly fetchUrl?: typeof fetch;
  /** Health checks before giving up: a cold function or a suspended database can fail the first. */
  readonly attempts?: number;
  /** Longer than the API's 10-second cache of a failed database check. */
  readonly retryDelayMs?: number;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

/**
 * The production smoke test (spec 0001, R9): the health check reports `ok` with the database
 * reached as the API's own role, the web app answers, both carry the security headers, and the
 * workflow runner refuses an unsigned request, the workflow webhook refuses an unknown token, and
 * `security.txt` is more than 30 days from its
 * `Expires` (spec 0004, R11; the weekly run catches it between deploys). It needs no secret, since
 * the production domain is public.
 */
export async function smokeTest(
  origin: URL,
  {
    fetchUrl = fetch,
    attempts = 6,
    retryDelayMs = 15_000,
    timeoutMs = 10_000,
    now = () => new Date(),
  }: SmokeOptions = {},
): Promise<Violation[]> {
  const request = (path: string, init: RequestInit = {}) =>
    fetchUrl(new URL(path, origin), {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  const get = (path: string) => request(path);

  let health = await get('/v1/health');
  let problem = await healthProblem(health);
  for (let attempt = 1; attempt < attempts && problem !== undefined; attempt += 1) {
    await sleep(retryDelayMs);
    health = await get('/v1/health');
    problem = await healthProblem(health);
  }
  const violations: Violation[] = problem === undefined ? [] : [{ where: '/v1/health', problem }];

  const page = await get('/');
  if (page instanceof Error) {
    violations.push({ where: '/', problem: `request failed: ${page.name}` });
  } else if (
    page.status !== 200 ||
    !(page.headers.get('content-type') ?? '').startsWith('text/html')
  ) {
    violations.push({
      where: '/',
      problem: `answered ${String(page.status)} ${page.headers.get('content-type') ?? ''}`,
    });
  }

  // The Workflow SDK's runner is a queue consumer that only the platform's queue may invoke
  // (spec 0001, R6; ADR-0009). An unsigned request from outside must not reach its handler, which
  // would answer 400 for the missing queue headers.
  const runner = await request(workflowRunnerPath, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (runner instanceof Error) {
    violations.push({ where: workflowRunnerPath, problem: `request failed: ${runner.name}` });
  } else if (!platformRejections.has(runner.status)) {
    violations.push({
      where: workflowRunnerPath,
      problem: `answered ${String(runner.status)} to an unsigned request`,
    });
  }

  // The webhook route is public; with no hook created (a static test holds that), it must refuse a
  // token it does not know, as the SDK or the platform may (spec 0001, R6).
  const webhook = await request(`${workflowWebhookPath}${crypto.randomUUID()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (webhook instanceof Error) {
    violations.push({ where: workflowWebhookPath, problem: `request failed: ${webhook.name}` });
  } else if (!platformRejections.has(webhook.status)) {
    violations.push({
      where: workflowWebhookPath,
      problem: `answered ${String(webhook.status)} to an unknown token`,
    });
  }

  const contact = await securityTxtProblem(await get(securityTxtPath), now());
  if (contact !== undefined) violations.push({ where: securityTxtPath, problem: contact });

  for (const [path, response] of [
    ['/', page],
    ['/v1/health', health],
  ] as const) {
    if (response instanceof Error) continue;
    for (const [name, expected] of Object.entries(securityHeaders)) {
      if (response.headers.get(name) !== expected) {
        violations.push({ where: path, problem: `header ${name} is missing or differs` });
      }
    }
  }
  return violations;
}

async function securityTxtProblem(
  response: Response | Error,
  now: Date,
): Promise<string | undefined> {
  if (response instanceof Error) return `request failed: ${response.name}`;
  if (response.status !== 200) return `answered ${String(response.status)}`;
  const text = await response.text();
  if (!/^Contact: https:\/\/\S+$/m.test(text)) return 'names no https Contact';
  // RFC 9116 asks for an RFC 3339 timestamp; Date.parse alone would also take `2027` or `Nov 4 2027`.
  const value =
    /^Expires: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))$/m.exec(
      text,
    )?.[1];
  const expires = value === undefined ? Number.NaN : Date.parse(value);
  if (Number.isNaN(expires)) return 'has no valid Expires';
  const days = Math.floor((expires - now.getTime()) / dayMs);
  return days > renewalDays ? undefined : `expires in ${String(days)} days; renew Expires`;
}

async function healthProblem(response: Response | Error): Promise<string | undefined> {
  if (response instanceof Error) return `request failed: ${response.name}`;
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
