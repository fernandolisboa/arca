import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { checkWorkflow, type SecretsPolicy } from '../src/check-workflow-secrets.ts';

const listed = { secrets: ['ANTHROPIC_API_KEY'], environments: ['review'] };
const policy: SecretsPolicy = Object.fromEntries(
  [
    'allowed.yml',
    'pull-request-clean.yml',
    'unlisted-secret.yml',
    'unlisted-environment.yml',
    'whole-context.yml',
    'indexed-context.yml',
    'secret-in-if.yml',
    'inherit.yml',
    'pull-request-secret.yml',
    'pull-request-environment.yml',
  ].map((file) => [file, listed]),
);

async function check(file: string, withPolicy = policy) {
  const source = await readFile(new URL(`./fixtures/workflows/${file}`, import.meta.url), 'utf8');
  return checkWorkflow(file, source, withPolicy);
}

describe('workflow secrets lint', () => {
  it.each(['allowed.yml', 'pull-request-clean.yml'])('accepts %s', async (file) => {
    expect(await check(file)).toEqual([]);
  });

  it.each([
    ['a secret not on the allow-list', 'unlisted-secret.yml'],
    ['an environment not on the allow-list', 'unlisted-environment.yml'],
    ['the whole secrets context', 'whole-context.yml'],
    ['an indexed secrets lookup', 'indexed-context.yml'],
    ['a secret in an if condition', 'secret-in-if.yml'],
    ['secrets: inherit', 'inherit.yml'],
    ['a secret on pull_request, even when listed', 'pull-request-secret.yml'],
    ['an environment on pull_request, even when listed', 'pull-request-environment.yml'],
  ])('rejects %s', async (_label, file) => {
    expect((await check(file)).length).toBeGreaterThan(0);
  });

  it('rejects a workflow missing from the policy', async () => {
    expect(await check('allowed.yml', {})).toHaveLength(1);
  });
});
