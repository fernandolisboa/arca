import { describe, expect, it } from 'vitest';
import { isPageInPlaceOfFile } from '../src/pwa/cached-page.js';

describe('isPageInPlaceOfFile', () => {
  it.each([
    ['https://arca.test/assets/index-abc.js?__WB_REVISION__=1', 'text/html; charset=utf-8', true],
    ['https://arca.test/recovery-boot.js', 'text/html', true],
    ['https://arca.test/manifest.webmanifest', 'text/html', true],
    ['https://arca.test/index.html?__WB_REVISION__=1', 'text/html; charset=utf-8', false],
    ['https://arca.test/assets/index-abc.js', 'text/javascript', false],
    ['https://arca.test/manifest.webmanifest', 'application/manifest+json', false],
    ['https://arca.test/icons/icon-192.png', null, false],
  ])('%s as %s: %s', (url, contentType, expected) => {
    expect(isPageInPlaceOfFile(url, contentType)).toBe(expected);
  });
});
