import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  checkAction,
  checkWorkflow,
  expressionsIn,
  type SecretsPolicy,
} from '../src/check-workflow-secrets.ts';

const fixtures = new URL('./fixtures/workflows/', import.meta.url);
const listed = { secrets: ['ANTHROPIC_API_KEY'], environments: ['review'] };
const policy: SecretsPolicy = Object.fromEntries(
  (await readdir(fixtures)).map((file) => [file, listed]),
);

async function check(file: string, withPolicy = policy) {
  return checkWorkflow(file, await readFile(new URL(file, fixtures), 'utf8'), withPolicy);
}

const problems = async (file: string) => (await check(file)).map(({ problem }) => problem);

describe('workflow secrets lint', () => {
  it.each([
    'allowed.yml',
    'allowed-case-insensitive.yml',
    'pull-request-clean.yml',
    'github-property.yml',
  ])('accepts %s', async (file) => {
    expect(await check(file)).toEqual([]);
  });

  it.each([
    [
      'a secret not on the allow-list',
      'unlisted-secret.yml',
      'uses secret VERCEL_TOKEN, which is not allowed',
    ],
    [
      'an environment not on the allow-list',
      'unlisted-environment.yml',
      'uses environment production, which is not allowed',
    ],
    [
      'the whole secrets context',
      'whole-context.yml',
      'uses the secrets context other than as secrets.NAME',
    ],
    [
      'an indexed secrets lookup',
      'indexed-context.yml',
      'uses the secrets context other than as secrets.NAME',
    ],
    [
      'a secret in an if condition',
      'secret-in-if.yml',
      'uses secret VERCEL_TOKEN, which is not allowed',
    ],
    ['secrets: inherit', 'inherit.yml', 'passes secrets: inherit to a reusable workflow'],
    [
      'a secret on pull_request, even when listed',
      'pull-request-secret.yml',
      'runs on pull_request and uses secret ANTHROPIC_API_KEY',
    ],
    [
      'an environment on pull_request, even when listed',
      'pull-request-environment.yml',
      'runs on pull_request and uses environment review',
    ],
    [
      'an upper-case secrets context',
      'uppercase-context.yml',
      'runs on pull_request and uses secret ANTHROPIC_API_KEY',
    ],
    [
      'a mixed-case secrets context in if',
      'uppercase-if.yml',
      'uses secret VERCEL_TOKEN, which is not allowed',
    ],
    [
      'a secret after }} in a string literal',
      'quoted-braces.yml',
      'runs on pull_request and uses secret ANTHROPIC_API_KEY',
    ],
    ['an unterminated expression', 'unterminated.yml', 'has an unterminated expression'],
    ['github.token', 'github-token.yml', 'uses secret GITHUB_TOKEN, which is not allowed'],
    [
      'the whole github context',
      'whole-github-context.yml',
      'uses the github context other than as github.NAME',
    ],
    [
      'a %YAML 1.1 directive that hides the trigger from the parser',
      'yaml-1-1.yml',
      'has no on: trigger this lint can read',
    ],
    ['a workflow without a trigger', 'no-trigger.yml', 'has no on: trigger this lint can read'],
    [
      'a mixed-case pull_request trigger',
      'mixed-case-trigger.yml',
      'runs on pull_request and uses secret ANTHROPIC_API_KEY',
    ],
  ])('rejects %s', async (_label, file, expected) => {
    expect(await problems(file)).toContainEqual(expect.stringContaining(expected));
  });

  it('rejects a workflow missing from the policy', async () => {
    expect(await check('allowed.yml', {})).toEqual([
      { where: 'allowed.yml', problem: 'is not in the secrets policy' },
    ]);
  });
});

describe('expression scanning', () => {
  it('ends an expression only outside string literals', () => {
    expect(expressionsIn("a ${{ x('}}', 'it''s') }} b ${{ y }}")).toEqual({
      bodies: [" x('}}', 'it''s') ", ' y '],
      unterminated: false,
    });
  });

  it('reports an unterminated expression', () => {
    expect(expressionsIn("${{ x('}}') ").unterminated).toBe(true);
  });
});

describe('composite actions', () => {
  const action = (env: string) =>
    [
      'runs:',
      '  using: composite',
      '  steps:',
      '    - run: echo',
      '      shell: bash',
      '      env:',
      `        V: ${env}`,
    ].join('\n');

  it('accepts an action that takes its values as inputs', () => {
    expect(checkAction('setup/action.yml', action('${{ inputs.token }}'))).toEqual([]);
  });

  it.each([
    [
      '${{ github.token }}',
      'uses secret GITHUB_TOKEN; pass it from the workflow as an input instead',
    ],
    ['${{ SECRETS.KEY }}', 'uses secret KEY; pass it from the workflow as an input instead'],
  ])('rejects %s', (env, problem) => {
    expect(checkAction('setup/action.yml', action(env))).toEqual([
      { where: 'setup/action.yml', problem },
    ]);
  });
});
