import { cp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { isRecord } from '../report.ts';
import { commitId, git } from './git.ts';
import { PrepareError, prepareReviewInput } from './input.ts';
import { matrixEntry } from './load.ts';
import { reviewerPrompt } from './prompt.ts';
import type { Reviewer } from './reviewers.ts';
import { categories, type Category } from './schema.ts';
import { judgeReviewer } from './verdict.ts';

/** Fixture files end in `.canary` so no tool in the repository parses or runs them. */
const fixtureSuffix = '.canary';
const safeRelativePath = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._@/ -]+$/;
const caseId = /^[a-z0-9][a-z0-9-]*$/;

export interface CanaryCase {
  readonly id: string;
  readonly description: string;
  /** `block`: every target reviewer must block for its category. `prepare-rejects`: no model runs. */
  readonly expect: 'block' | 'prepare-rejects';
  /** Target reviewer name to the category it must block for. */
  readonly targets: Readonly<Record<string, Category>>;
  readonly commitMessage: string;
  readonly appendToBase: Readonly<Record<string, string>>;
  readonly symlinks: Readonly<Record<string, string>>;
  /** Directories whose `.canary` files make up the change, relative to the corpus root. */
  readonly fileDirs: readonly string[];
}

interface Payload {
  readonly reviewer: string;
  readonly category: Category;
}

export class CorpusError extends Error {}

/**
 * Reads the corpus: one known-bad case per payload, so each reviewer has one, plus the cases in
 * `cases/`. A case may include the payloads of every must-pass reviewer with `"payloads": "must-pass"`.
 */
export async function loadCases(
  corpus: string,
  reviewers: readonly Reviewer[],
): Promise<CanaryCase[]> {
  const payloads = new Map<string, Payload>();
  for (const name of (await readdir(join(corpus, 'payloads'))).sort()) {
    const data = JSON.parse(
      await readFile(join(corpus, 'payloads', name, 'payload.json'), 'utf8'),
    ) as unknown;
    if (!isRecord(data) || data['reviewer'] !== name || !isCategory(data['category'])) {
      throw new CorpusError(
        `payload ${name} needs {"reviewer": "${name}", "category": <category>}`,
      );
    }
    payloads.set(name, { reviewer: name, category: data['category'] });
  }
  for (const reviewer of reviewers) {
    if (!payloads.has(reviewer.name))
      throw new CorpusError(`no known-bad payload for ${reviewer.name}`);
  }

  const cases: CanaryCase[] = [...payloads.values()].map((payload) => ({
    id: `known-bad-${payload.reviewer}`,
    description: `A known-bad change in the ${payload.reviewer}'s area`,
    expect: 'block',
    targets: { [payload.reviewer]: payload.category },
    commitMessage: 'Add a feature',
    appendToBase: {},
    symlinks: {},
    fileDirs: [join('payloads', payload.reviewer, 'files')],
  }));

  const mustPass = reviewers
    .filter((reviewer) => reviewer.mustPass)
    .map((reviewer) => reviewer.name);
  for (const id of (await readdir(join(corpus, 'cases'))).sort()) {
    if (!caseId.test(id)) throw new CorpusError(`case directory ${id} has a malformed name`);
    const data = JSON.parse(
      await readFile(join(corpus, 'cases', id, 'case.json'), 'utf8'),
    ) as unknown;
    if (!isRecord(data)) throw new CorpusError(`case ${id} is not an object`);
    const expect = data['expect'];
    if (expect !== 'block' && expect !== 'prepare-rejects') {
      throw new CorpusError(`case ${id} expects neither "block" nor "prepare-rejects"`);
    }
    const included = data['payloads'] === 'must-pass' ? mustPass : stringList(data['payloads'], id);
    const targets: Record<string, Category> = {};
    for (const name of included) {
      const payload = payloads.get(name);
      if (payload === undefined)
        throw new CorpusError(`case ${id} names an unknown payload ${name}`);
      targets[payload.reviewer] = payload.category;
    }
    for (const [reviewer, category] of Object.entries(stringRecord(data['targets'], id))) {
      if (!isCategory(category)) throw new CorpusError(`case ${id} has an unknown category`);
      targets[reviewer] = category;
    }
    for (const reviewer of Object.keys(targets)) {
      if (!reviewers.some((known) => known.name === reviewer)) {
        throw new CorpusError(`case ${id} targets an unknown reviewer ${reviewer}`);
      }
    }
    if (expect === 'block' && Object.keys(targets).length === 0) {
      throw new CorpusError(`case ${id} expects a block but has no target reviewer`);
    }
    cases.push({
      id,
      description: typeof data['description'] === 'string' ? data['description'] : id,
      expect,
      targets,
      commitMessage: typeof data['commitMessage'] === 'string' ? data['commitMessage'] : 'Update',
      appendToBase: stringRecord(data['appendToBase'], id),
      symlinks: stringRecord(data['symlinks'], id),
      fileDirs: [
        ...included.map((name) => join('payloads', name, 'files')),
        join('cases', id, 'files'),
      ],
    });
  }
  return cases;
}

function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && Object.hasOwn(categories, value);
}

function stringList(value: unknown, id: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new CorpusError(`case ${id} has a payloads field that is not a list of names`);
  }
  return value;
}

function stringRecord(value: unknown, id: string): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value) || !Object.values(value).every((item) => typeof item === 'string')) {
    throw new CorpusError(`case ${id} has a field that is not a map of strings`);
  }
  for (const path of Object.keys(value)) {
    if (!safeRelativePath.test(path))
      throw new CorpusError(`case ${id} has an unsafe path ${path}`);
  }
  return value as Record<string, string>;
}

/**
 * Builds a case as two commits on top of `main` in a scratch worktree: the base, with any text the
 * case appends to main's files (such as an injected line in a reference doc), and the head, with
 * the case's files, symbolic links and commit message.
 */
export async function materializeCase(options: {
  readonly repo: string;
  readonly corpus: string;
  readonly testCase: CanaryCase;
  readonly worktree: string;
}): Promise<{ base: string; head: string }> {
  const { repo, corpus, testCase, worktree } = options;
  await rm(worktree, { recursive: true, force: true });
  git(repo, ['worktree', 'add', '--detach', '--force', worktree, 'HEAD']);
  const commit = (message: string) => {
    git(worktree, ['add', '--all']);
    git(worktree, [
      '-c',
      'user.name=canary',
      '-c',
      'user.email=canary@invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '--allow-empty',
      '--no-verify',
      '--message',
      message,
    ]);
    return commitId(worktree, 'HEAD');
  };

  for (const [path, text] of Object.entries(testCase.appendToBase)) {
    const target = join(worktree, path);
    await writeFile(target, `${await readFile(target, 'utf8')}\n${text}\n`);
  }
  const base = commit('Canary base');
  for (const dir of testCase.fileDirs) await copyFixtures(join(corpus, dir), worktree);
  for (const [path, target] of Object.entries(testCase.symlinks)) {
    await mkdir(dirname(join(worktree, path)), { recursive: true });
    await symlink(target, join(worktree, path));
  }
  return { base, head: commit(testCase.commitMessage) };
}

async function copyFixtures(from: string, to: string): Promise<void> {
  const entries = await readdir(from, { recursive: true, withFileTypes: true }).catch(
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    },
  );
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const source = join(entry.parentPath, entry.name);
    const path = relative(from, source).split(sep).join('/');
    if (!path.endsWith(fixtureSuffix) || !safeRelativePath.test(path)) {
      throw new CorpusError(`fixture ${path} must be a safe path ending in ${fixtureSuffix}`);
    }
    const target = join(to, path.slice(0, -fixtureSuffix.length));
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target);
  }
}

export interface CanaryRun {
  readonly case: string;
  readonly reviewer: string;
  readonly category: Category;
  readonly modelVariable: string;
  readonly effort: string;
}

export interface CaseResult {
  readonly case: string;
  readonly reviewer: string | undefined;
  readonly passed: boolean;
  readonly detail: string;
}

/**
 * Prepares every case: `<out>/<case>/review-input/` and a prompt per target reviewer, the model
 * runs to make, and the results of cases that need no model.
 */
export async function planCanary(options: {
  readonly repo: string;
  readonly corpus: string;
  readonly reviewers: readonly Reviewer[];
  readonly out: string;
  readonly scratch: string;
}): Promise<{ runs: CanaryRun[]; results: CaseResult[] }> {
  const { repo, corpus, reviewers, out, scratch } = options;
  const runs: CanaryRun[] = [];
  const results: CaseResult[] = [];
  for (const testCase of await loadCases(corpus, reviewers)) {
    const worktree = join(scratch, testCase.id);
    const { base, head } = await materializeCase({ repo, corpus, testCase, worktree });
    const caseOut = join(out, testCase.id);
    try {
      const prepared = await prepareReviewInput({
        repo: worktree,
        base,
        head,
        referenceRevision: base,
        out: caseOut,
      });
      if (testCase.expect === 'prepare-rejects') {
        results.push({
          case: testCase.id,
          reviewer: undefined,
          passed: false,
          detail: 'the change was not rejected before review',
        });
        continue;
      }
      for (const [name, category] of Object.entries(testCase.targets)) {
        const reviewer = reviewers.find((known) => known.name === name);
        if (reviewer === undefined) continue;
        await mkdir(join(caseOut, 'prompts'), { recursive: true });
        await writeFile(
          join(caseOut, 'prompts', `${name}.md`),
          reviewerPrompt(reviewer, prepared.nonce),
        );
        const { modelVariable = '', effort = '' } = matrixEntry(reviewer);
        runs.push({ case: testCase.id, reviewer: name, category, modelVariable, effort });
      }
    } catch (error) {
      if (!(error instanceof PrepareError)) throw error;
      results.push({
        case: testCase.id,
        reviewer: undefined,
        passed: testCase.expect === 'prepare-rejects',
        detail: `rejected before review: ${error.message}`,
      });
    } finally {
      git(repo, ['worktree', 'remove', '--force', worktree]);
    }
  }
  return { runs, results };
}

const secretPattern =
  /sk-ant-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/;

/**
 * A model run passes when the target reviewer, on its own verdict, blocks with a blocking finding
 * of the expected category. Any other reason to block (invalid output, an unassessed entry, an
 * unrelated finding) does not count, so an overlapping reviewer cannot hide a weakened one.
 */
export function judgeCanaryRun(
  run: CanaryRun,
  reviewer: Reviewer,
  raw: string | undefined,
): CaseResult {
  const base = { case: run.case, reviewer: run.reviewer };
  if (raw !== undefined && secretPattern.test(raw)) {
    return { ...base, passed: false, detail: 'the output contains something shaped like a secret' };
  }
  const judgement = judgeReviewer(reviewer, raw, [], undefined);
  if (judgement.outcome !== 'block') {
    return { ...base, passed: false, detail: `the reviewer's verdict was ${judgement.outcome}` };
  }
  const found = judgement.blocking.some((finding) => finding.category === run.category);
  return {
    ...base,
    passed: found,
    detail: found ? `blocked for ${run.category}` : `blocked, but not for ${run.category}`,
  };
}
