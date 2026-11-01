import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parse } from 'yaml';
import { isRecord, reportViolations, type Violation } from './report.ts';

/** Per workflow file name, the secrets and environments it may use (spec 0001, R8). */
export type SecretsPolicy = Readonly<
  Record<string, { readonly secrets: readonly string[]; readonly environments: readonly string[] }>
>;

// GitHub resolves context names case-insensitively, so both patterns use the `i` flag.
const secretReference = /(?<![\w.-])secrets(?![\w-])(?:\s*\.\s*([A-Za-z_][A-Za-z0-9_]*))?/gi;
const githubReference = /(?<![\w.-])github(?![\w-])(?:\s*\.\s*([A-Za-z_][\w-]*))?/gi;

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
  collectExpressions(workflow, expressions, add);

  const secrets = new Set<string>();
  for (const text of expressions) {
    for (const match of text.matchAll(secretReference)) {
      if (match[1] !== undefined) secrets.add(match[1].toUpperCase());
      else add(`uses the secrets context other than as secrets.NAME: "${text.trim()}"`);
    }
    for (const match of text.matchAll(githubReference)) {
      if (match[1] === undefined)
        add(`uses the github context other than as github.NAME: "${text.trim()}"`);
      else if (match[1].toLowerCase() === 'token') secrets.add('GITHUB_TOKEN');
    }
  }
  if (containsInheritedSecrets(workflow)) add('passes secrets: inherit to a reusable workflow');

  const onPullRequest = triggers(workflow).includes('pull_request');
  const allowedSecrets = allowed.secrets.map((secret) => secret.toUpperCase());
  const allowedEnvironments = allowed.environments.map((environment) => environment.toLowerCase());

  for (const secret of secrets) {
    if (onPullRequest) add(`runs on pull_request and uses secret ${secret}`);
    else if (!allowedSecrets.includes(secret)) add(`uses secret ${secret}, which is not allowed`);
  }
  for (const environment of jobEnvironments(workflow)) {
    if (onPullRequest) add(`runs on pull_request and uses environment ${environment}`);
    else if (!allowedEnvironments.includes(environment.toLowerCase())) {
      add(`uses environment ${environment}, which is not allowed`);
    }
  }
  return violations;
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
