import { describe, expect, it } from 'vitest';
import {
  checkFetcherFor,
  offlineFetcher,
  ruleCheckerFor,
} from '../src/knowledge/check/environment.js';
import { scriptedCheckerChoice } from '../src/knowledge/check/scripted-checker.js';

describe('the rule checker and fetcher each deployment has (ADR-0027)', () => {
  it.each([
    ['production', undefined],
    ['preview', scriptedCheckerChoice],
    ['development', scriptedCheckerChoice],
  ] as const)('%s checks with %o', (environment, checker) => {
    expect(ruleCheckerFor(environment)).toBe(checker);
  });

  it('reads nothing only on a development server that asks for it', () => {
    expect(checkFetcherFor('development', true)).toBe(offlineFetcher);
    expect(checkFetcherFor('preview', true)).not.toBe(offlineFetcher);
    expect(checkFetcherFor('production', true)).not.toBe(offlineFetcher);
  });
});
