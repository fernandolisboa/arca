import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { oneLine, whenMissing } from '../report.ts';
import { parseAcceptances } from './acceptances.ts';
import { judgeCanaryRun, planCanary, type CanaryRun, type CaseResult } from './canary.ts';
import { inert, renderComment } from './comment.ts';
import { gateFingerprint, pinnedModels } from './fingerprint.ts';
import { blobText, objectId } from './git.ts';
import {
  awaitCanary,
  canaryState,
  createCheckRun,
  githubRequest,
  reportCanaryProblem,
  upsertComment,
} from './github.ts';
import { PrepareError, prepareReviewInput } from './input.ts';
import { changeReviewers, mainReviewers, matrixEntry } from './load.ts';
import { writePrompts, writeSchema } from './prompt.ts';
import type { AgentDefinition, Reviewer } from './reviewers.ts';
import { judgeGate, judgeReviewer, type CanaryStatus } from './verdict.ts';

const repo = process.cwd();

function option(values: Record<string, string | boolean | undefined>, name: string): string {
  const value = values[name];
  if (typeof value !== 'string' || value === '') throw new Error(`--${name} is required`);
  return value;
}

function sha(values: Record<string, string | boolean | undefined>, name: string): string {
  const value = option(values, name);
  if (!objectId.test(value)) throw new Error(`--${name} must be a full commit SHA`);
  return value;
}

function pullRequestNumber(values: Record<string, string | boolean | undefined>): number {
  const value = Number(option(values, 'pr'));
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error('--pr must be a pull request number');
  return value;
}

async function setOutput(name: string, value: string): Promise<void> {
  const file = process.env['GITHUB_OUTPUT'];
  if (file !== undefined) await appendFile(file, `${name}=${value}\n`);
}

async function readOptional(path: string): Promise<string | undefined> {
  return readFile(path, 'utf8').catch(whenMissing(undefined));
}

function repository(): string {
  const name = process.env['GITHUB_REPOSITORY'] ?? '';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name))
    throw new Error('GITHUB_REPOSITORY is not set');
  return name;
}

function request() {
  const token = process.env['GITHUB_TOKEN'];
  if (token === undefined || token === '') throw new Error('GITHUB_TOKEN is not set');
  return githubRequest(token, process.env['GITHUB_API_URL']);
}

/** prepare: the review input, prompts and matrix for one pull request, from main's definitions. */
async function prepare(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { base: { type: 'string' }, head: { type: 'string' }, out: { type: 'string' } },
  });
  const out = option(values, 'out');
  await mkdir(out, { recursive: true });
  const reviewers = await mainReviewers(repo);
  try {
    const prepared = await prepareReviewInput({
      repo,
      base: sha(values, 'base'),
      head: sha(values, 'head'),
      referenceRevision: 'HEAD',
      out,
    });
    await writePrompts(out, reviewers, prepared.nonce);
    await writeSchema(out);
    await writeFile(join(out, 'acceptances.md'), prepared.acceptances);
    if (prepared.changedAgents !== undefined) {
      const head = sha(values, 'head');
      const reviewMarkdown = blobText(repo, `${head}:docs/REVIEW.md`);
      await writeFile(
        join(out, 'change-agents.json'),
        JSON.stringify({ agents: prepared.changedAgents, reviewMarkdown }),
      );
    }
    await setOutput('matrix', JSON.stringify({ include: reviewers.map(matrixEntry) }));
    await setOutput('agents-changed', String(prepared.changedAgents !== undefined));
  } catch (error) {
    if (!(error instanceof PrepareError)) throw error;
    await writeFile(
      join(out, 'prepare-error.txt'),
      `The change was rejected before review: ${error.message}.\n`,
    );
    throw error;
  }
}

/** canary-plan: every case prepared, the model runs as a matrix, and the cases that need none. */
async function canaryPlan(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      out: { type: 'string' },
      scratch: { type: 'string' },
      'change-agents': { type: 'string' },
      'skip-if-passed': { type: 'boolean' },
    },
  });
  const out = option(values, 'out');
  const changeAgentsFile = values['change-agents'];
  let reviewers;
  if (changeAgentsFile === undefined) {
    reviewers = await mainReviewers(repo);
    const fingerprint = gateFingerprint(repo, 'HEAD', pinnedModels(process.env));
    await setOutput('fingerprint', fingerprint);
    if (
      values['skip-if-passed'] === true &&
      (await canaryState(request(), repository(), fingerprint)) === 'passed'
    ) {
      console.log('The canary already passed for this gate fingerprint.');
      await setOutput('skip', 'true');
      return;
    }
  } else {
    const data = JSON.parse(await readFile(changeAgentsFile, 'utf8')) as {
      agents: AgentDefinition[];
      reviewMarkdown: string;
    };
    reviewers = changeReviewers(data.agents, data.reviewMarkdown);
  }
  await setOutput('skip', 'false');
  const { runs, results } = await planCanary({
    repo,
    corpus: join(repo, 'eval', 'review-gate'),
    reviewers,
    out: join(out, 'cases'),
    scratch: option(values, 'scratch'),
  });
  await writeSchema(out);
  await writeFile(join(out, 'plan.json'), JSON.stringify({ runs, results, reviewers }));
  await setOutput('matrix', JSON.stringify({ include: runs }));
  await setOutput('has-runs', String(runs.length > 0));
  console.log(
    `Prepared ${String(runs.length)} model runs and ${String(results.length)} cases without a model.`,
  );
}

/** canary-evaluate: judges every run on its own verdict and writes the result; fails on any miss. */
async function canaryEvaluate(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      plan: { type: 'string' },
      outputs: { type: 'string' },
      out: { type: 'string' },
      alert: { type: 'boolean' },
    },
  });
  const plan = JSON.parse(await readFile(option(values, 'plan'), 'utf8')) as {
    runs: CanaryRun[];
    results: CaseResult[];
    reviewers: Reviewer[];
  };
  const results = [...plan.results];
  for (const run of plan.runs) {
    const reviewer = plan.reviewers.find((known) => known.name === run.reviewer);
    if (reviewer === undefined) throw new Error(`the plan has no reviewer ${run.reviewer}`);
    const raw = await readOptional(
      join(option(values, 'outputs'), run.case, `${run.reviewer}.json`),
    );
    results.push(judgeCanaryRun(run, reviewer, raw));
  }
  const passed = results.length > 0 && results.every((result) => result.passed);
  await writeFile(option(values, 'out'), JSON.stringify({ passed, results }, null, 2));
  for (const result of results) {
    console.log(
      `${result.passed ? 'pass' : 'FAIL'}  ${result.case}${result.reviewer === undefined ? '' : ` / ${result.reviewer}`}: ${result.detail}`,
    );
  }
  if (!passed && values.alert === true) {
    await reportCanaryProblem(request(), repository(), 'The canary failed on main.');
  }
  process.exitCode = passed ? 0 : 1;
}

/** report: the verdict and the comment, from schema fields only. */
async function report(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      input: { type: 'string' },
      outputs: { type: 'string' },
      head: { type: 'string' },
      pr: { type: 'string' },
      'change-canary': { type: 'string' },
      out: { type: 'string' },
    },
  });
  const input = option(values, 'input');
  const pullRequest = pullRequestNumber(values);
  const reviewers = await mainReviewers(repo);
  const acceptances = parseAcceptances((await readOptional(join(input, 'acceptances.md'))) ?? '');
  const judgments = await Promise.all(
    reviewers.map(async (reviewer) =>
      judgeReviewer(
        reviewer,
        await readOptional(join(option(values, 'outputs'), `${reviewer.name}.json`)),
        acceptances,
        pullRequest,
      ),
    ),
  );

  let canary: CanaryStatus;
  const changeCanary = values['change-canary'];
  if (changeCanary !== undefined) {
    const result = await readOptional(changeCanary);
    canary =
      result !== undefined && (JSON.parse(result) as { passed: unknown }).passed === true
        ? { state: 'passed' }
        : {
            state: 'failed',
            detail: "The canary with this change's reviewer definitions did not pass.",
          };
  } else {
    const github = request();
    const fingerprint = gateFingerprint(repo, 'HEAD', pinnedModels(process.env));
    canary = await awaitCanary(github, repository(), fingerprint);
    if (canary.state !== 'passed') await reportCanaryProblem(github, repository(), canary.detail);
  }

  const verdict = judgeGate(judgments, canary);
  // The message can quote a path or frontmatter key from the change, so it is made inert too.
  const prepareErrorText = await readOptional(join(input, 'prepare-error.txt'));
  const prepareError =
    prepareErrorText === undefined ? undefined : inert(prepareErrorText.slice(0, 1000));
  const comment = renderComment({ headSha: sha(values, 'head'), judgments, canary, verdict });
  const out = option(values, 'out');
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, 'comment.md'),
    prepareError === undefined ? comment : `${comment}\n${prepareError}\n`,
  );
  const summary = [
    verdict.pass ? 'All reviewers pass and the canary passed.' : 'The gate failed.',
    verdict.failing.length > 0 ? `Failing reviewers: ${verdict.failing.join(', ')}.` : '',
    canary.state === 'passed' ? '' : `Canary: ${canary.detail}`,
    prepareError ?? '',
  ]
    .filter((line) => line !== '')
    .join('\n');
  await writeFile(join(out, 'verdict.json'), JSON.stringify({ pass: verdict.pass, summary }));
  console.log(summary);
}

/** publish: the check run on the reviewed commit and the comment, or a failure when withheld. */
async function publish(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      report: { type: 'string' },
      head: { type: 'string' },
      pr: { type: 'string' },
      withheld: { type: 'boolean' },
    },
  });
  const github = request();
  const head = sha(values, 'head');
  const verdictText = await readOptional(join(option(values, 'report'), 'verdict.json'));
  if (values.withheld === true || verdictText === undefined) {
    const reason =
      values.withheld === true
        ? 'The comment matched the secret scan, so it was not posted.'
        : 'The report job did not produce a verdict.';
    await createCheckRun(github, repository(), head, false, reason);
    return;
  }
  const verdict = JSON.parse(verdictText) as { pass: boolean; summary: string };
  await createCheckRun(github, repository(), head, verdict.pass, verdict.summary);
  await upsertComment(
    github,
    repository(),
    pullRequestNumber(values),
    await readFile(join(option(values, 'report'), 'comment.md'), 'utf8'),
  );
}

const commands: Record<string, (args: string[]) => Promise<void>> = {
  prepare,
  'canary-plan': canaryPlan,
  'canary-evaluate': canaryEvaluate,
  report,
  publish,
};

if (import.meta.main) {
  const [command = '', ...args] = process.argv.slice(2);
  const run = commands[command];
  if (run === undefined) throw new Error(`usage: cli.ts ${Object.keys(commands).join('|')} …`);
  try {
    await run(args);
  } catch (error) {
    console.error(oneLine(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
