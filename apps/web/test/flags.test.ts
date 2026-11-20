import { describe, expect, it } from 'vitest';
import { flagUrl } from '../src/flags.js';

describe('flagUrl', () => {
  it.each(['US', 'pt', 'Jp'])('finds the flag of %s in either case', (code) => {
    expect(flagUrl(code)).toMatch(/\.svg/);
  });

  it.each(['ZZ', '', 'USA', '../us', 'u1'])('has no flag for %j', (code) => {
    expect(flagUrl(code)).toBeUndefined();
  });
});
