import { describe, expect, it } from 'vitest';
import {
  type PageDraft,
  type PassageDraft,
  type RouteRequestDraft,
  canAddSource,
  pageAddresses,
  routeRequestSources,
  stepReady,
} from '../src/knowledge/route-request-draft.js';

const page = (id: number, url: string, file?: PageDraft['file']): PageDraft => ({
  id,
  url,
  ...(file === undefined ? {} : { file }),
});
const passage = (id: number, text: string, pageUrl = ''): PassageDraft => ({
  id,
  topic: 'amounts',
  text,
  pageUrl,
});
const draft = (parts: Partial<RouteRequestDraft> = {}): RouteRequestDraft => ({
  countryCode: 'lt',
  note: 'Residência temporária para trabalho.',
  pages: [],
  passages: [],
  ...parts,
});
const ready = { name: 'pagina.pdf', state: 'ready', uploadId: 'u1' } as const;

describe('stepReady', () => {
  it.each<[string, RouteRequestDraft, boolean]>([
    ['a country and a note', draft(), true],
    ['no country', draft({ countryCode: '' }), false],
    ['a blank note', draft({ note: '  ' }), false],
  ])('the route step with %s: %s', (_label, value, expected) => {
    expect(stepReady('route', value)).toBe(expected);
  });

  it.each<[string, readonly PageDraft[], boolean]>([
    ['no page', [], false],
    ['only blank pages', [page(0, ' ')], false],
    ['a page with a full https address', [page(0, 'https://migracija.lrv.lt/lt/')], true],
    ['a page and a blank one', [page(0, 'https://migracija.lrv.lt/'), page(1, '')], true],
    ['an http address', [page(0, 'http://migracija.lrv.lt/')], false],
    ['an address with no host', [page(0, 'https://')], false],
    ['a copy and no address', [page(0, '', ready)], false],
    [
      'a copy still sending',
      [page(0, 'https://a.gov.lt/', { name: 'a.pdf', state: 'sending' })],
      false,
    ],
    [
      'a copy that failed',
      [page(0, 'https://a.gov.lt/', { name: 'a.pdf', state: 'failed' })],
      false,
    ],
    ['an uploaded copy', [page(0, 'https://a.gov.lt/', ready)], true],
  ])('the pages step with %s: %s', (_label, pages, expected) => {
    expect(stepReady('pages', draft({ pages }))).toBe(expected);
  });

  it('lets the passages and review steps go on with no passage', () => {
    expect(stepReady('passages', draft())).toBe(true);
    expect(stepReady('review', draft())).toBe(true);
  });
});

describe('routeRequestSources', () => {
  it('files each page as its copy or a link, then each passage with its page', () => {
    expect(
      routeRequestSources(
        draft({
          pages: [
            page(0, ' https://a.gov.lt/fees ', ready),
            page(1, 'https://a.gov.lt/apply'),
            page(2, ''),
          ],
          passages: [
            passage(3, ' A taxa é de 120 euros. ', 'https://a.gov.lt/fees'),
            passage(4, 'O pedido leva 4 meses.'),
            passage(5, '   '),
          ],
        }),
      ),
    ).toEqual([
      { kind: 'file', uploadId: 'u1', pageUrl: 'https://a.gov.lt/fees' },
      { kind: 'link', url: 'https://a.gov.lt/apply' },
      { kind: 'text', text: 'A taxa é de 120 euros.', url: 'https://a.gov.lt/fees' },
      { kind: 'text', text: 'O pedido leva 4 meses.' },
    ]);
  });
});

describe('the source limit', () => {
  it('stops adding at twenty pages and passages together', () => {
    const pages = Array.from({ length: 12 }, (_, id) => page(id, `https://a.gov.lt/${String(id)}`));
    const passages = Array.from({ length: 7 }, (_, id) => passage(id + 12, 'x'));
    expect(canAddSource(draft({ pages, passages }))).toBe(true);
    expect(canAddSource(draft({ pages, passages: [...passages, passage(19, 'y')] }))).toBe(false);
  });
});

describe('pageAddresses', () => {
  it('offers each full address once', () => {
    expect(
      pageAddresses([
        page(0, 'https://a.gov.lt/fees'),
        page(1, ' https://a.gov.lt/fees'),
        page(2, 'not an address'),
      ]),
    ).toEqual(['https://a.gov.lt/fees']);
  });
});
