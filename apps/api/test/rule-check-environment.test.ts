import { describe, expect, it } from 'vitest';
import {
  checkFetcherFor,
  offlineFetcher,
  passageLocatorFor,
  ruleCheckerFor,
} from '../src/knowledge/check/environment.js';
import { scriptedLocator } from '../src/knowledge/check/locator.js';
import { ruleCheckModel } from '../src/knowledge/check/model.js';
import { ruleCheckPromptVersion } from '../src/knowledge/check/prompt.js';
import { scriptedCheckerChoice } from '../src/knowledge/check/scripted-checker.js';

describe('the rule checker and fetcher each deployment has (ADR-0027)', () => {
  it('checks with Claude in production, and with nothing there without a key', () => {
    expect(ruleCheckerFor('production', 'sk-ant-test')).toMatchObject({
      model: ruleCheckModel,
      promptVersion: ruleCheckPromptVersion,
    });
    expect(ruleCheckerFor('production', undefined)).toBeUndefined();
  });

  it.each(['preview', 'development'] as const)(
    '%s checks with the scripted checker, key or not',
    (environment) => {
      expect(ruleCheckerFor(environment, 'sk-ant-test')).toBe(scriptedCheckerChoice);
      expect(ruleCheckerFor(environment, undefined)).toBe(scriptedCheckerChoice);
    },
  );

  it('picks passages with a model only in production with a key', () => {
    expect(passageLocatorFor('production', 'sk-ant-test')).not.toBe(scriptedLocator);
    expect(passageLocatorFor('production', undefined)).toBe(scriptedLocator);
    expect(passageLocatorFor('preview', 'sk-ant-test')).toBe(scriptedLocator);
    expect(passageLocatorFor('development', 'sk-ant-test')).toBe(scriptedLocator);
  });

  it('reads nothing only on a development server that asks for it', () => {
    expect(checkFetcherFor('development', true)).toBe(offlineFetcher);
    expect(checkFetcherFor('preview', true)).not.toBe(offlineFetcher);
    expect(checkFetcherFor('production', true)).not.toBe(offlineFetcher);
  });
});
