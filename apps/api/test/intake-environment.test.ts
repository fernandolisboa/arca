import { describe, expect, it } from 'vitest';
import { extractorFor } from '../src/intake/environment.js';
import { fakeExtractor } from '../src/intake/fake-extractor.js';

describe('the extractor each deployment has (spec 0008, R1)', () => {
  it.each([
    ['production', 'sk-ant-test', true],
    ['preview', 'sk-ant-test', true],
    ['development', 'sk-ant-test', true],
    ['preview', undefined, false],
    ['production', undefined, false],
    ['development', undefined, false],
  ] as const)('%s with key %j has one: %s', (environment, key, has) => {
    expect(extractorFor(environment, key) !== undefined).toBe(has);
  });

  it('gives the scripted extractor only to a development server that asks for it', () => {
    expect(extractorFor('development', undefined, true)).toBe(fakeExtractor);
    expect(extractorFor('development', 'sk-ant-test', true)).toBe(fakeExtractor);
    expect(extractorFor('preview', undefined, true)).toBeUndefined();
    expect(extractorFor('production', 'sk-ant-test', true)).toBeDefined();
    expect(extractorFor('production', 'sk-ant-test', true)).not.toBe(fakeExtractor);
    expect(extractorFor('production', undefined, true)).toBeUndefined();
  });
});
