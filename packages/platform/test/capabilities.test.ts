import { describe, expect, it } from 'vitest';
import { capabilities, webCapabilities, type WebFeatures } from '../src/index.js';

const everything: WebFeatures = {
  pushApi: true,
  standalone: false,
  keyStorage: true,
  webShare: true,
};

describe('web capabilities (spec 0005, R5)', () => {
  it('offers what the browser has, except receiving shared files', () => {
    const web = webCapabilities(everything);
    expect(capabilities.filter((capability) => !web.has(capability))).toEqual([
      'receiveSharedFiles',
    ]);
    expect(web.whyUnavailable('receiveSharedFiles')).toBe('unsupported');
  });

  it.each([
    ['needs-install', { pushApi: false, standalone: false }],
    ['unsupported', { pushApi: false, standalone: true }],
    [undefined, { pushApi: true, standalone: false }],
  ] as const)('reports notifications as %s for %o', (reason, features) => {
    expect(webCapabilities({ ...everything, ...features }).whyUnavailable('notifications')).toBe(
      reason,
    );
  });

  it.each([
    ['keyStorage', { keyStorage: false }],
    ['sharing', { webShare: false }],
  ] as const)('reports %s as unsupported without its API', (capability, features) => {
    const web = webCapabilities({ ...everything, ...features });
    expect(web.has(capability)).toBe(false);
    expect(web.whyUnavailable(capability)).toBe('unsupported');
  });
});
