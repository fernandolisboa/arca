import { describe, expect, it } from 'vitest';
import { isRecord } from '../../src/report.ts';
import { commentMarker } from '../../src/review-gate/comment.ts';
import {
  awaitCanary,
  canaryState,
  upsertComment,
  type GitHubRequest,
} from '../../src/review-gate/github.ts';

const repository = 'owner/repo';
const fingerprint = 'f'.repeat(64);

interface Fake {
  artifacts?: unknown[];
  runs?: Record<number, unknown>;
  inProgress?: unknown[];
  completed?: unknown[];
  comments?: unknown[];
}

function fake(state: Fake) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const request: GitHubRequest = (method, path, body) => {
    calls.push({ method, path, body });
    if (path.includes('/actions/artifacts'))
      return Promise.resolve({ artifacts: state.artifacts ?? [] });
    const run = /\/actions\/runs\/(\d+)$/.exec(path);
    if (run) return Promise.resolve(state.runs?.[Number(run[1])]);
    if (path.includes('status=in_progress'))
      return Promise.resolve({ workflow_runs: state.inProgress ?? [] });
    if (path.includes('status=queued')) return Promise.resolve({ workflow_runs: [] });
    const finished = /[?&]branch=main&status=(failure|timed_out|startup_failure)&/.exec(path);
    if (finished)
      return Promise.resolve({
        workflow_runs: (state.completed ?? []).filter(
          (run) => isRecord(run) && run['conclusion'] === finished[1],
        ),
      });
    if (method === 'GET' && path.includes('/comments'))
      return Promise.resolve(state.comments ?? []);
    return Promise.resolve({});
  };
  return { request, calls };
}

const goodRun = {
  path: '.github/workflows/review-canary.yml',
  head_branch: 'main',
  event: 'push',
  conclusion: 'success',
  run_number: 10,
  repository: { full_name: repository },
};
const artifact = { expired: false, workflow_run: { id: 1, head_branch: 'main' } };

describe('canary lookup', () => {
  it('passes for an artifact from a successful run of main canary workflow', async () => {
    const { request } = fake({ artifacts: [artifact], runs: { 1: goodRun } });
    expect(await canaryState(request, repository, fingerprint)).toBe('passed');
  });

  it.each([
    ['another workflow', { path: '.github/workflows/fake.yml' }],
    ['another branch', { head_branch: 'feature' }],
    ['a pull_request event', { event: 'pull_request' }],
    ['a pull_request_target event', { event: 'pull_request_target' }],
    ['a failed run', { conclusion: 'failure' }],
    ['another repository', { repository: { full_name: 'fork/repo' } }],
  ])('does not count an artifact from %s', async (_label, change) => {
    const { request } = fake({ artifacts: [artifact], runs: { 1: { ...goodRun, ...change } } });
    expect(await canaryState(request, repository, fingerprint)).toBe('missing');
  });

  it('does not count a pass older than the newest failed canary run on main', async () => {
    const { request } = fake({
      artifacts: [artifact],
      runs: { 1: goodRun },
      completed: [
        { event: 'workflow_dispatch', conclusion: 'cancelled', run_number: 13 },
        { event: 'schedule', conclusion: 'timed_out', run_number: 12 },
        { event: 'push', conclusion: 'success', run_number: 10 },
      ],
    });
    expect(await canaryState(request, repository, fingerprint)).toBe('missing');
  });

  it('keeps an old pass revoked after a newer pass under another fingerprint', async () => {
    const { request } = fake({
      artifacts: [artifact],
      runs: { 1: goodRun },
      completed: [
        { event: 'workflow_dispatch', conclusion: 'success', run_number: 14 },
        { event: 'schedule', conclusion: 'failure', run_number: 12 },
        { event: 'push', conclusion: 'success', run_number: 10 },
      ],
    });
    expect(await canaryState(request, repository, fingerprint)).toBe('missing');
  });

  it('counts a pass newer than every failure, ignoring cancelled, skipped and pull request runs', async () => {
    const { request } = fake({
      artifacts: [artifact],
      runs: { 1: goodRun },
      completed: [
        { event: 'pull_request_target', conclusion: 'failure', run_number: 13 },
        { event: 'schedule', conclusion: 'cancelled', run_number: 12 },
        { event: 'push', conclusion: 'skipped', run_number: 11 },
        { event: 'push', conclusion: 'success', run_number: 10 },
        { event: 'schedule', conclusion: 'failure', run_number: 9 },
      ],
    });
    expect(await canaryState(request, repository, fingerprint)).toBe('passed');
  });

  it('does not count an expired artifact', async () => {
    const { request } = fake({ artifacts: [{ ...artifact, expired: true }], runs: { 1: goodRun } });
    expect(await canaryState(request, repository, fingerprint)).toBe('missing');
  });

  it('reports a canary still running on main', async () => {
    const { request } = fake({ inProgress: [{ event: 'push' }] });
    expect(await canaryState(request, repository, fingerprint)).toBe('running');
  });

  it('gives up waiting at the limit', async () => {
    const { request } = fake({ inProgress: [{ event: 'schedule' }] });
    expect(await awaitCanary(request, repository, fingerprint, { pollMs: 1, limitMs: 0 })).toEqual({
      state: 'missing',
      detail: 'The canary run on main did not finish within 30 minutes.',
    });
  });
});

describe('comment', () => {
  it('updates the gate comment from github-actions and ignores look-alikes', async () => {
    const { request, calls } = fake({
      comments: [
        { id: 5, body: `${commentMarker}\nfake`, user: { login: 'someone' } },
        { id: 6, body: `${commentMarker}\nold`, user: { login: 'github-actions[bot]' } },
      ],
    });
    await upsertComment(request, repository, 9, 'new');
    expect(calls.at(-1)).toEqual({
      method: 'PATCH',
      path: '/repos/owner/repo/issues/comments/6',
      body: { body: 'new' },
    });
  });

  it('adds the comment the first time', async () => {
    const { request, calls } = fake({ comments: [] });
    await upsertComment(request, repository, 9, 'new');
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      path: '/repos/owner/repo/issues/9/comments',
      body: { body: 'new' },
    });
  });
});
