import { isRecord } from '../report.ts';
import { commentMarker } from './comment.ts';
import type { CanaryStatus } from './verdict.ts';

export const canaryWorkflow = '.github/workflows/review-canary.yml';
/** Events whose canary runs count: only runs of main's own definition. */
const canaryEvents = new Set(['push', 'schedule', 'workflow_dispatch']);

export type GitHubRequest = (
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: Record<string, unknown>,
) => Promise<unknown>;

/** A minimal GitHub REST client for the Actions runner, with the job's own token. */
export function githubRequest(token: string, apiUrl = 'https://api.github.com'): GitHubRequest {
  return async (method, path, body) => {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new Error(`GitHub API ${method} ${path} answered ${String(response.status)}`);
    return response.status === 204 ? undefined : await response.json();
  };
}

export function canaryArtifactName(fingerprint: string): string {
  return `canary-pass-${fingerprint}`;
}

function records(value: unknown, key: string): Record<string, unknown>[] {
  const list = isRecord(value) ? value[key] : undefined;
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

/**
 * Whether the canary passed for this gate fingerprint: an artifact named for it, uploaded by a
 * successful first attempt of main's canary workflow. An artifact from any other workflow, branch
 * or event does not count, so a side branch cannot fake one. A re-run does not count, since it
 * reads the model variables again and may test other models than the plan fingerprinted. A pass
 * older than the newest failed canary run on main does not count either: a model alias can move to
 * a new model without changing the fingerprint, so an old pass may vouch for a model that has
 * since failed (ADR-0013).
 */
export async function canaryState(
  request: GitHubRequest,
  repository: string,
  fingerprint: string,
): Promise<'passed' | 'running' | 'missing'> {
  const failedAfter = await newestFailedCanaryRun(request, repository);
  const artifacts = records(
    await request(
      'GET',
      `/repos/${repository}/actions/artifacts?name=${canaryArtifactName(fingerprint)}&per_page=100`,
    ),
    'artifacts',
  );
  for (const artifact of artifacts) {
    const run = isRecord(artifact['workflow_run']) ? artifact['workflow_run'] : {};
    if (artifact['expired'] === true || run['head_branch'] !== 'main') continue;
    const details = await request('GET', `/repos/${repository}/actions/runs/${String(run['id'])}`);
    if (
      isRecord(details) &&
      details['path'] === canaryWorkflow &&
      details['head_branch'] === 'main' &&
      canaryEvents.has(String(details['event'])) &&
      details['conclusion'] === 'success' &&
      isRecord(details['repository']) &&
      details['repository']['full_name'] === repository &&
      details['run_attempt'] === 1 &&
      typeof details['run_number'] === 'number' &&
      details['run_number'] > failedAfter
    ) {
      return 'passed';
    }
  }
  for (const status of ['in_progress', 'queued', 'waiting']) {
    const runs = records(
      await request('GET', canaryRunsPath(repository, status, 20)),
      'workflow_runs',
    );
    if (runs.some((run) => canaryEvents.has(String(run['event'])))) return 'running';
  }
  return 'missing';
}

/**
 * Conclusions of a run that tested a model and did not pass. Cancelled and skipped runs prove
 * nothing, and neither does a startup failure, which runs no model.
 */
const failedConclusions = ['failure', 'timed_out'] as const;

/** The run number of the newest canary run on main that failed, or 0 when there is none. */
async function newestFailedCanaryRun(request: GitHubRequest, repository: string): Promise<number> {
  let newest = 0;
  for (const conclusion of failedConclusions) {
    const runs = records(
      await request('GET', canaryRunsPath(repository, conclusion, 100)),
      'workflow_runs',
    );
    for (const run of runs) {
      const number = run['run_number'];
      if (
        run['conclusion'] === conclusion &&
        canaryEvents.has(String(run['event'])) &&
        typeof number === 'number'
      ) {
        newest = Math.max(newest, number);
      }
    }
  }
  return newest;
}

function canaryRunsPath(repository: string, status: string, perPage: number): string {
  const file = canaryWorkflow.slice(canaryWorkflow.lastIndexOf('/') + 1);
  return `/repos/${repository}/actions/workflows/${file}/runs?branch=main&status=${status}&per_page=${String(perPage)}`;
}

/** Waits for a running canary, up to the limit in spec 0001 R10 (30 minutes). */
export async function awaitCanary(
  request: GitHubRequest,
  repository: string,
  fingerprint: string,
  options: { readonly pollMs: number; readonly limitMs: number } = {
    pollMs: 60_000,
    limitMs: 30 * 60_000,
  },
): Promise<CanaryStatus> {
  const deadline = Date.now() + options.limitMs;
  for (;;) {
    const state = await canaryState(request, repository, fingerprint);
    if (state === 'passed') return { state: 'passed' };
    if (state === 'missing') {
      return {
        state: 'missing',
        detail:
          'No passing canary run on main for the current gate and models, or a later canary run on main failed.',
      };
    }
    if (Date.now() + options.pollMs > deadline) {
      return {
        state: 'missing',
        detail: 'The canary run on main did not finish within 30 minutes.',
      };
    }
    await new Promise((resolve) => setTimeout(resolve, options.pollMs));
  }
}

const canaryIssueTitle = 'Review gate canary has not passed for the current gate';

/** Opens one issue for a missing or failed canary; an open one is not repeated. */
export async function reportCanaryProblem(
  request: GitHubRequest,
  repository: string,
  detail: string,
): Promise<void> {
  const open = await request(
    'GET',
    `/repos/${repository}/issues?state=open&creator=github-actions%5Bbot%5D&per_page=100`,
  );
  if (
    Array.isArray(open) &&
    open.some((issue) => isRecord(issue) && issue['title'] === canaryIssueTitle)
  )
    return;
  await request('POST', `/repos/${repository}/issues`, {
    title: canaryIssueTitle,
    body: `${detail}\n\nUntil the canary passes on main, \`review-gate\` fails on every pull request. Dispatch the canary workflow on main; if the fix is the review workflow itself, follow the recovery in ADR-0012.\n`,
  });
}

/** Creates the completed `review-gate` check run on the reviewed commit. */
export async function createCheckRun(
  request: GitHubRequest,
  repository: string,
  headSha: string,
  pass: boolean,
  summary: string,
): Promise<void> {
  await request('POST', `/repos/${repository}/check-runs`, {
    name: 'review-gate',
    head_sha: headSha,
    status: 'completed',
    conclusion: pass ? 'success' : 'failure',
    output: { title: pass ? 'Review gate passed' : 'Review gate failed', summary },
  });
}

/** Updates the gate's comment on the pull request, or adds it the first time. */
export async function upsertComment(
  request: GitHubRequest,
  repository: string,
  pullRequest: number,
  body: string,
): Promise<void> {
  const comments = await request(
    'GET',
    `/repos/${repository}/issues/${String(pullRequest)}/comments?per_page=100`,
  );
  const existing: unknown = Array.isArray(comments)
    ? (comments as unknown[]).find(
        (comment) =>
          isRecord(comment) &&
          typeof comment['body'] === 'string' &&
          comment['body'].startsWith(commentMarker) &&
          isRecord(comment['user']) &&
          comment['user']['login'] === 'github-actions[bot]',
      )
    : undefined;
  if (isRecord(existing)) {
    await request('PATCH', `/repos/${repository}/issues/comments/${String(existing['id'])}`, {
      body,
    });
  } else {
    await request('POST', `/repos/${repository}/issues/${String(pullRequest)}/comments`, { body });
  }
}
