import { describe, expect, it } from 'vitest';
import { hostOf } from '../scripts/validate.ts';

describe('hostOf', () => {
  it.each([
    ['https://www.gov.example/law', 'www.gov.example'],
    ['https://WWW.Gov.Example/law?x=1#y', 'www.gov.example'],
    ['https://b\u00fccher.example/', 'xn--bcher-kva.example'],
  ])('reads the host of %s', (url, host) => {
    expect(hostOf(url)).toBe(host);
  });

  it.each([
    'http://gov.example/',
    'https://user@gov.example/',
    'https://@gov.example/',
    'https://:@gov.example/',
    'https://gov.example:/',
    'https://user:secret@gov.example/',
    'https://gov.example:8443/',
    'https://gov.example:443/',
    'https://[::1]/',
    'https:///user@gov.example/',
    'https:///gov.example:8443/',
    'https://\\user:pw@gov.example/',
    'https:////evil@gov.example/',
    'https://gov.example\\@evil.example/',
    'https://evil.example%2egov.example/',
    'https://evil.example\u3002gov.example/',
    'https://gov.example\t/',
    'not a url',
  ])('has no host to match for %s', (url) => {
    expect(hostOf(url)).toBeUndefined();
  });
});
