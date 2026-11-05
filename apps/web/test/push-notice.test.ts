import { ptBR } from '@arca/i18n/catalog';
import { describe, expect, it } from 'vitest';
import { pushNotice, pushPayload } from '../src/service-worker/push-notice.js';

const id = '4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d';

describe('the text a push shows (spec 0005, R7)', () => {
  it('words a known code from the catalog, tagged by its message', () => {
    expect(pushNotice({ code: 'new_sign_in', id })).toEqual({
      ...ptBR.push.new_sign_in,
      tag: `arca-${id}`,
    });
  });

  it.each([
    ['an unknown code', { code: 'something_else', id }],
    ['a prototype key', { code: 'constructor', id }],
    ['the fallback itself', { code: 'fallback', id }],
    ['no object', 'new_sign_in'],
    ['nothing', undefined],
  ])('shows the generic notice for %s', (_, payload) => {
    expect(pushNotice(payload)).toMatchObject(ptBR.push.fallback);
  });

  it('carries no link in any notice the catalog words', () => {
    // Deliberately broad: a notice never names a site, so even a domain-like word fails.
    for (const notice of Object.values(ptBR.push)) {
      expect(JSON.stringify(notice)).not.toMatch(/https?:|www\.|\.(?:com|app|br)\b/i);
    }
  });

  it('never puts anything but a UUID in the tag', () => {
    expect(pushNotice({ code: 'new_sign_in', id: '<b>' }).tag).toBe('arca');
  });

  it('reads JSON data, and nothing from data that is not', () => {
    expect(pushPayload({ json: () => ({ code: 'x' }) })).toEqual({ code: 'x' });
    expect(
      pushPayload({
        json: () => {
          throw new SyntaxError('not JSON');
        },
      }),
    ).toBeUndefined();
    expect(pushPayload(null)).toBeUndefined();
  });
});
