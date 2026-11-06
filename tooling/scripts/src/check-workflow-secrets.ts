import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parse } from 'yaml';
import { isRecord, reportViolations, whenMissing, type Violation } from './report.ts';

/** Per workflow file name, the secrets and environments it may use (spec 0001, R8). */
export type SecretsPolicy = Readonly<
  Record<string, { readonly secrets: readonly string[]; readonly environments: readonly string[] }>
>;

// GitHub resolves context names case-insensitively, so both patterns use the `i` flag.
const secretReference = /(?<![\w.-])secrets(?![\w-])(?:\s*\.\s*([A-Za-z_][A-Za-z0-9_]*))?/gi;
const githubReference = /(?<![\w.-])github(?![\w-])(?:\s*\.\s*([A-Za-z_][\w-]*))?/gi;

/**
 * Triggers whose workflow definition comes from a pull request's branch, or from whatever commit
 * was deployed (a preview branch, or a fork Vercel was allowed to build). Any repository secret the
 * policy lists is still readable from every branch of this repository (spec 0001, R8).
 */
const branchControlledTriggers = ['pull_request', 'deployment', 'deployment_status'];

/** A job-level call to a reusable workflow in this repository; group 1 is its file name. */
const reusableWorkflow = /^\.\/\.github\/workflows\/([A-Za-z0-9_-]+\.ya?ml)$/;

export function checkWorkflow(file: string, source: string, policy: SecretsPolicy): Violation[] {
  const name = basename(file);
  const violations: Violation[] = [];
  const add = (problem: string) => violations.push({ where: name, problem });
  const allowed = policy[name];
  if (allowed === undefined) {
    add('is not in the secrets policy');
    return violations;
  }

  const workflow = parse(source) as unknown;
  const workflowTriggers = triggers(workflow);
  // A parser that reads `on` differently from GitHub (a %YAML 1.1 directive makes it `true`) must
  // not turn the branch-controlled rule off silently.
  if (workflowTriggers.length === 0) add('has no on: trigger this lint can read');
  const secrets = secretsUsed(workflow, add);
  if (containsInheritedSecrets(workflow)) add('passes secrets: inherit to a reusable workflow');
  for (const local of localUses(workflow)) {
    if (!localTarget.test(local)) {
      add(
        `uses ${local}; local actions live in .github/actions/<name>, where this lint reads them`,
      );
    }
  }

  const branchTrigger = workflowTriggers.find((trigger) =>
    branchControlledTriggers.includes(trigger),
  );
  const allowedSecrets = allowed.secrets.map((secret) => secret.toUpperCase());
  const allowedEnvironments = allowed.environments.map((environment) => environment.toLowerCase());

  for (const secret of secrets) {
    if (branchTrigger) add(`runs on ${branchTrigger} and uses secret ${secret}`);
    else if (!allowedSecrets.includes(secret)) add(`uses secret ${secret}, which is not allowed`);
  }
  for (const environment of jobEnvironments(workflow)) {
    if (branchTrigger) add(`runs on ${branchTrigger} and uses environment ${environment}`);
    else if (!allowedEnvironments.includes(environment.toLowerCase())) {
      add(`uses environment ${environment}, which is not allowed`);
    }
  }
  // A called workflow runs with its caller's trigger, so the caller must be allowed whatever the
  // callee may use; otherwise a branch-controlled workflow could reach a secret through a local call.
  for (const uses of jobUses(workflow)) {
    if (!reusableWorkflow.test(uses)) {
      add(`calls ${uses}; reusable workflows must be local (./.github/workflows/<file>)`);
    }
  }
  for (const local of localUses(workflow)) {
    const callee = reusableWorkflow.exec(local)?.[1];
    if (callee === undefined) continue;
    const calleePolicy = policy[callee];
    if (calleePolicy === undefined) {
      add(`calls ${local}, which is not in the secrets policy`);
      continue;
    }
    for (const secret of calleePolicy.secrets) {
      if (branchTrigger !== undefined || !allowedSecrets.includes(secret.toUpperCase())) {
        add(`calls ${local}, which may use secret ${secret}`);
      }
    }
    for (const environment of calleePolicy.environments) {
      if (branchTrigger !== undefined || !allowedEnvironments.includes(environment.toLowerCase())) {
        add(`calls ${local}, which may use environment ${environment}`);
      }
    }
  }
  return violations;
}

/**
 * Composite actions get no secrets of their own; a workflow passes what an action needs as an
 * input, where the workflow's allow-list covers it. So an action may reference none.
 */
export function checkAction(file: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const add = (problem: string) => violations.push({ where: file, problem });
  for (const secret of secretsUsed(parse(source) as unknown, add)) {
    add(`uses secret ${secret}; pass it from the workflow as an input instead`);
  }
  return violations;
}

/** Secret names referenced in expressions, upper-cased; `github.token` counts as GITHUB_TOKEN. */
function secretsUsed(document: unknown, add: (problem: string) => void): Set<string> {
  const expressions: string[] = [];
  collectExpressions(document, expressions, add);
  const secrets = new Set<string>();
  for (const text of expressions) {
    for (const match of text.matchAll(secretReference)) {
      if (match[1] !== undefined) secrets.add(match[1].toUpperCase());
      else add(`uses the secrets context other than as secrets.NAME: "${text.trim()}"`);
    }
    for (const match of text.matchAll(githubReference)) {
      if (match[1] === undefined) {
        add(`uses the github context other than as github.NAME: "${text.trim()}"`);
      } else if (match[1].toLowerCase() === 'token') secrets.add('GITHUB_TOKEN');
    }
  }
  return secrets;
}

/**
 * Returns the body of every `${{ … }}` in a string. Like the Actions runner, a `}}` inside a
 * single-quoted literal does not end the expression; an unterminated expression is an error.
 */
export function expressionsIn(value: string): { bodies: string[]; unterminated: boolean } {
  const bodies: string[] = [];
  let start = value.indexOf('${{');
  while (start !== -1) {
    let inString = false;
    let end = -1;
    for (let index = start + 3; index < value.length; index++) {
      if (value[index] === "'") inString = !inString;
      else if (!inString && value.startsWith('}}', index)) {
        end = index;
        break;
      }
    }
    if (end === -1) return { bodies, unterminated: true };
    bodies.push(value.slice(start + 3, end));
    start = value.indexOf('${{', end + 2);
  }
  return { bodies, unterminated: false };
}

/** Expression bodies: every `${{ … }}`, and `if:` values, which GitHub evaluates as expressions. */
function collectExpressions(
  value: unknown,
  into: string[],
  add: (problem: string) => void,
  key?: string,
): void {
  if (typeof value === 'string') {
    if (key?.toLowerCase() === 'if') into.push(value);
    const { bodies, unterminated } = expressionsIn(value);
    into.push(...bodies);
    if (unterminated) add(`has an unterminated expression: "${value.trim()}"`);
  } else if (Array.isArray(value)) {
    for (const item of value) collectExpressions(item, into, add);
  } else if (isRecord(value)) {
    for (const [itemKey, item] of Object.entries(value)) {
      collectExpressions(itemKey, into, add);
      collectExpressions(item, into, add, itemKey);
    }
  }
}

/** A local action under .github/actions (optionally in a checkout directory) or a local workflow. */
const localTarget =
  /^\.\/(?:[A-Za-z0-9_-]+\/)?\.github\/actions\/[A-Za-z0-9_-]+$|^\.\/\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/;

function localUses(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(localUses);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, item]) =>
    key === 'uses' && typeof item === 'string' && item.startsWith('./') ? [item] : localUses(item),
  );
}

function containsInheritedSecrets(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsInheritedSecrets);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, item]) =>
      (key.toLowerCase() === 'secrets' &&
        typeof item === 'string' &&
        item.toLowerCase() === 'inherit') ||
      containsInheritedSecrets(item),
  );
}

/** The `uses` of every job that calls a reusable workflow, local or not. */
function jobUses(workflow: unknown): string[] {
  const jobs = isRecord(workflow) ? workflow['jobs'] : undefined;
  if (!isRecord(jobs)) return [];
  return Object.values(jobs).flatMap((job) => {
    const uses = isRecord(job) ? job['uses'] : undefined;
    return uses === undefined ? [] : [typeof uses === 'string' ? uses : JSON.stringify(uses)];
  });
}

function jobEnvironments(workflow: unknown): string[] {
  const jobs = isRecord(workflow) ? workflow['jobs'] : undefined;
  if (!isRecord(jobs)) return [];
  return Object.values(jobs).flatMap((job) => {
    const environment = isRecord(job) ? job['environment'] : undefined;
    if (typeof environment === 'string') return [environment];
    if (isRecord(environment)) return [String(environment['name'])];
    return [];
  });
}

function triggers(workflow: unknown): string[] {
  const on = isRecord(workflow) ? workflow['on'] : undefined;
  const names =
    typeof on === 'string'
      ? [on]
      : Array.isArray(on)
        ? on.map(String)
        : isRecord(on)
          ? Object.keys(on)
          : [];
  return names.map((trigger) => trigger.toLowerCase());
}

/** YAML files directly in a directory, or `<dir>/<name>/action.yml` when `nested`. */
async function yamlFiles(
  dir: string,
  nested: boolean,
  violations: Violation[],
): Promise<{ name: string; source: string }[]> {
  const entries = nested
    ? (await readdir(dir)).flatMap((name) => [`${name}/action.yml`, `${name}/action.yaml`])
    : (await readdir(dir)).filter((name) => /\.ya?ml$/.test(name));
  const files: { name: string; source: string }[] = [];
  for (const name of entries) {
    const path = join(dir, name);
    const stat = await lstat(path).catch(() => undefined);
    if (stat === undefined) continue;
    if (!stat.isFile()) violations.push({ where: name, problem: 'is not a regular file' });
    else files.push({ name, source: await readFile(path, 'utf8') });
  }
  return files;
}

/** Usage: check-workflow-secrets.ts <policy.json> <workflows dir> [<actions dir>] */
async function main(): Promise<void> {
  const [policyPath, workflowsDir, actionsDir] = process.argv.slice(2);
  if (policyPath === undefined || workflowsDir === undefined) {
    throw new Error(
      'usage: check-workflow-secrets.ts <policy.json> <workflows dir> [<actions dir>]',
    );
  }
  const policy = JSON.parse(await readFile(policyPath, 'utf8')) as SecretsPolicy;
  const violations: Violation[] = [];
  for (const { name, source } of await yamlFiles(workflowsDir, false, violations)) {
    violations.push(...checkWorkflow(name, source, policy));
  }
  if (actionsDir !== undefined) {
    // Only a missing directory means "no actions"; any other error fails the lint.
    const actions = await yamlFiles(actionsDir, true, violations).catch(whenMissing([]));
    for (const { name, source } of actions) violations.push(...checkAction(name, source));
  }
  reportViolations(violations);
}

if (import.meta.main) await main();
