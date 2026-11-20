import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flagUrl } from '../src/flags.js';

const flagsDir = join(import.meta.dirname, '../node_modules/flag-icons/flags/4x3');

describe('flagUrl', () => {
  it.each(['US', 'pt', 'Jp'])('finds the flag of %s in either case', (code) => {
    expect(flagUrl(code)).toMatch(/\.svg/);
  });

  it.each(['ZZ', '', 'USA', '../us', 'u1'])('has no flag for %j', (code) => {
    expect(flagUrl(code)).toBeUndefined();
  });
});

describe('the bundled flag files', () => {
  // The files are served from the app's origin, so a version bump must not bring active content.
  it('hold drawings only: no script, event handler, foreign content or outside address', () => {
    const active =
      /<script|\son[a-z]+\s*=|<foreignObject|javascript:|(?:href|src)\s*=\s*["'](?!#)/i;
    const files = readdirSync(flagsDir).filter((file) => file.endsWith('.svg'));
    expect(files.length).toBeGreaterThan(200);
    expect(files.filter((file) => active.test(readFileSync(join(flagsDir, file), 'utf8')))).toEqual(
      [],
    );
  });
});
