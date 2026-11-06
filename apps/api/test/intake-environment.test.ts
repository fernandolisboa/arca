import { describe, expect, it } from 'vitest';
import { extractorFor } from '../src/intake/environment.js';
import { fakeExtractor } from '../src/intake/fake-extractor.js';

describe('the extractor each deployment has (spec 0008, R1)', () => {
  it.each([
    ['production', 'sk-ant-test', false],
    ['preview', 'sk-ant-test', true],
    ['development', 'sk-ant-test', true],
    ['preview', undefined, false],
    ['production', undefined, false],
  ] as const)('%s with key %j has one: %s', (environment, key, has) => {
    expect(extractorFor(environment, key) !== undefined).toBe(has);
  });

  it('gives development without a key the scripted extractor', () => {
    expect(extractorFor('development', undefined)).toBe(fakeExtractor);
  });
});
