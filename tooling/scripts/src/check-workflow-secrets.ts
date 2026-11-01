import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parse } from 'yaml';
import { reportViolations, type Violation } from './workspace.ts';

/** Per workflow file name, the secrets and environments it may use (spec 0001, R8). */
export type SecretsPolicy = Readonly<
  Record<string, { readonly secrets: readonly string[]; readonly environments: readonly string[] }>
>;

const expression = /\$\{\{([\s\S]*?)\}\}/g;
const secretReference = /(?<![\w.-])secrets(?![\w-])(?:\s*\.\s*([A-Za-z_][A-Za-z0-9_]*))?/g;

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
  const expressions: string[] = [];
  collectExpressions(workflow, expressions);

  const secrets = new Set<string>();
  for (const text of expressions) {
    for (const match of text.matchAll(secretReference)) {
      if (match[1] !== undefined) secrets.add(match[1]);
      else add(`uses the secrets context other than as secrets.NAME: "${text.trim()}"`);
    }
  }
  if (containsInheritedSecrets(workflow)) add('passes secrets: inherit to a reusable workflow');

  const environments = jobEnvironments(workflow);
  const onPullRequest = triggers(workflow).includes('pull_request');

  for (const secret of secrets) {
    if (onPullRequest) add(`runs on pull_request and uses secret ${secret}`);
    else if (!allowed.secrets.includes(secret)) add(`uses secret ${secret}, which is not allowed`);
  }
  for (const environment of environments) {
    if (onPullRequest) add(`runs on pull_request and uses environment ${environment}`);
    else if (!allowed.environments.includes(environment)) {
      add(`uses environment ${environment}, which is not allowed`);
    }
  }
  return violations;
}

/** Expression bodies: every `${{ … }}`, and `if:` values, which GitHub evaluates as expressions. */
function collectExpressions(value: unknown, into: string[], key?: string): void {
  if (typeof value === 'string') {
    if (key === 'if') into.push(value);
    for (const match of value.matchAll(expression)) into.push(match[1] ?? '');
  } else if (Array.isArray(value)) {
    for (const item of value) collectExpressions(item, into);
  } else if (isRecord(value)) {
    for (const [itemKey, item] of Object.entries(value)) {
      collectExpressions(itemKey, into);
      collectExpressions(item, into, itemKey);
    }
  }
}

function containsInheritedSecrets(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsInheritedSecrets);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, item]) => (key === 'secrets' && item === 'inherit') || containsInheritedSecrets(item),
  );
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
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  if (isRecord(on)) return Object.keys(on);
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Usage: check-workflow-secrets.ts <policy.json> <workflows dir> */
async function main(): Promise<void> {
  const [policyPath, workflowsDir] = process.argv.slice(2);
  if (policyPath === undefined || workflowsDir === undefined) {
    throw new Error('usage: check-workflow-secrets.ts <policy.json> <workflows dir>');
  }
  const policy = JSON.parse(await readFile(policyPath, 'utf8')) as SecretsPolicy;
  const files = (await readdir(workflowsDir)).filter((file) => /\.ya?ml$/.test(file));
  const violations: Violation[] = [];
  for (const file of files) {
    violations.push(
      ...checkWorkflow(file, await readFile(join(workflowsDir, file), 'utf8'), policy),
    );
  }
  reportViolations(violations);
}

if (import.meta.main) await main();
