import { hostOf as buildHostOf } from '@arca/scripts/host';
import { bundledRuleData } from '@arca/knowledge/bundled';
import { describe, expect, it } from 'vitest';
import { hostOf } from '../src/knowledge/host.js';

// The API matches hosts as the knowledge build does (ADR-0031), without importing the build's code.
describe('hostOf', () => {
  it('answers what the build answers', () => {
    const urls = [
      ...Object.keys(bundledRuleData.hosts),
      'https://www.gov.example/law',
      'https://WWW.Gov.Example./a?b#c',
      'https://bücher.example/',
      'https://user@gov.example/',
      'https://gov.example:8443/',
      'http://gov.example/',
      'https://gov.example\\@evil.example/',
      'https://gov%2eexample/',
      'https://gov。example/',
      'https:/gov.example/',
      'not a url',
    ];
    for (const url of urls) expect(hostOf(url), url).toBe(buildHostOf(url));
  });
});
