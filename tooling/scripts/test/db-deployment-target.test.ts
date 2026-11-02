import { describe, expect, it } from 'vitest';
import { deploymentFor, endpointOf, markToWrite } from '../src/db/deployment-target.ts';

const neonHost = 'ep-quiet-field-a1b2c3d4.sa-east-1.aws.neon.tech';
const mark = (endpoint: string) => `arca production endpoint: ${endpoint}`;

describe('deploymentFor', () => {
  it.each([
    [
      'a production build of main',
      { VERCEL: '1', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' },
      'production',
    ],
    [
      'a preview build',
      { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature' },
      'preview',
    ],
    ['a development build', { VERCEL: '1', VERCEL_ENV: 'development' }, 'preview'],
    ['a build with no environment', { VERCEL: '1' }, 'preview'],
  ])('reads %s', (_case, env, expected) => {
    expect(deploymentFor(env, neonHost)).toBe(expected);
  });

  it('refuses a production build from another branch', () => {
    expect(() =>
      deploymentFor(
        { VERCEL: '1', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'feature' },
        neonHost,
      ),
    ).toThrow('a production build must come from main');
  });

  it('allows the CI container outside Vercel and refuses Neon there', () => {
    expect(deploymentFor({}, '127.0.0.1')).toBeUndefined();
    for (const host of [neonHost, `${neonHost}.`, neonHost.toUpperCase()]) {
      expect(() => deploymentFor({ VERCEL_ENV: 'production' }, host)).toThrow(
        'only a Vercel build may bootstrap or migrate a Neon database',
      );
    }
  });

  it.each(['127.0.0.1', 'db.example.com', 'pooler.sa-east-1.aws.neon.tech'])(
    'refuses a Vercel build that reaches %s',
    (host) => {
      expect(() => deploymentFor({ VERCEL: '1', VERCEL_ENV: 'preview' }, host)).toThrow(
        'a Vercel build must reach a Neon endpoint',
      );
    },
  );
});

describe('endpointOf', () => {
  it.each([
    [neonHost, 'ep-quiet-field-a1b2c3d4'],
    ['ep-quiet-field-a1b2c3d4-pooler.sa-east-1.aws.neon.tech', 'ep-quiet-field-a1b2c3d4'],
    ['EP-Quiet-Field-A1B2C3D4.sa-east-1.aws.neon.tech', 'ep-quiet-field-a1b2c3d4'],
  ])('reads the endpoint of %s', (host, endpoint) => {
    expect(endpointOf(host)).toBe(endpoint);
  });
});

describe('markToWrite', () => {
  it.each<[string, Parameters<typeof markToWrite>, string | undefined]>([
    [
      'marks an unmarked database on the first production build',
      ['production', 'ep-a', null],
      mark('ep-a'),
    ],
    [
      'replaces an unrelated comment on the first production build',
      ['production', 'ep-a', 'hello'],
      mark('ep-a'),
    ],
    ['accepts production on its own endpoint', ['production', 'ep-a', mark('ep-a')], undefined],
    ['accepts a preview on a branch of production', ['preview', 'ep-b', mark('ep-a')], undefined],
  ])('%s', (_case, args, expected) => {
    expect(markToWrite(...args)).toBe(expected);
  });

  it.each<[string, Parameters<typeof markToWrite>, string]>([
    [
      'a preview that reaches production',
      ['preview', 'ep-a', mark('ep-a')],
      'a preview build reaches the production database',
    ],
    [
      'a preview on an unmarked database',
      ['preview', 'ep-b', null],
      'a preview build needs a branch of the marked production database',
    ],
    [
      'production on another endpoint',
      ['production', 'ep-b', mark('ep-a')],
      'this production build reaches a database marked for another endpoint',
    ],
  ])('refuses %s', (_case, args, message) => {
    expect(() => markToWrite(...args)).toThrow(message);
  });
});
