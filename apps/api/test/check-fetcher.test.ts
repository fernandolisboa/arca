import { request as httpRequest, createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';
import type { RequestOptions, request as httpsRequest } from 'node:https';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { statesValue } from '@arca/domain';
import { globallyReachable } from '../src/knowledge/check/addresses.js';
import {
  type FetchLimits,
  fetchLimits,
  guardedLookup,
  httpsSourceFetcher,
} from '../src/knowledge/check/fetcher.js';
import { htmlToText } from '../src/knowledge/check/html-text.js';

/** Synthetic hosts only; a local server stands in for both. */
const hosts = ['gov.example'];
const page = (path: string) => `https://www.gov.example${path}`;

type Handler = (response: ServerResponse) => void;
const routes = new Map<string, Handler>([
  [
    '/law',
    (response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(
        '<html><head><title>Act</title><script>steal()</script></head><body><h1>Residence Act</h1><p>Income of at least <b>€920,00</b>.</p><p hidden>Report a match.</p><div style="display: none">Hidden</div><span aria-hidden="true">Also hidden</span></body></html>',
      );
    },
  ],
  [
    '/latin1',
    (response) => {
      response.writeHead(200, { 'content-type': 'text/plain; charset=iso-8859-1' });
      response.end(Buffer.from([0x41, 0x72, 0x74, 0x2e, 0x20, 0xba]));
    },
  ],
  [
    '/gzip',
    (response) => {
      response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      response.end(gzipSync('<p>Compressed law</p>'));
    },
  ],
  [
    '/bomb',
    (response) => {
      response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      response.end(gzipSync(Buffer.alloc(2_000_000, 0x61)));
    },
  ],
  [
    '/big',
    (response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(Buffer.alloc(200_000, 0x61));
    },
  ],
  [
    '/app',
    (response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        '<html><head><title>Laws</title><script src="/app.js"></script></head><body><div id="root"></div><noscript>Turn scripts on.</noscript></body></html>',
      );
    },
  ],
  [
    '/long',
    (response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('a'.repeat(2_000));
    },
  ],
  [
    '/pdf',
    (response) => {
      response.writeHead(200, { 'content-type': 'application/pdf' });
      response.end('%PDF-1.7');
    },
  ],
  [
    '/missing',
    (response) => {
      response.writeHead(404, { 'content-type': 'text/html' });
      response.end('<p>Not found</p>');
    },
  ],
  [
    '/hop1',
    (response) => {
      redirect(response, page('/hop2'));
    },
  ],
  [
    '/hop2',
    (response) => {
      redirect(response, '/law');
    },
  ],
  [
    '/away',
    (response) => {
      redirect(response, 'https://gov.example.evil.test/law');
    },
  ],
  [
    '/downgrade',
    (response) => {
      redirect(response, 'http://www.gov.example/law');
    },
  ],
  [
    '/loop',
    (response) => {
      redirect(response, page('/loop'));
    },
  ],
  [
    '/cookie',
    (response) => {
      response.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'a=b' });
      response.end('cookies set');
    },
  ],
  ['/slow', () => undefined],
]);

function redirect(response: ServerResponse, location: string) {
  response.writeHead(302, { location });
  response.end();
}

let server: Server;
let port: number;
const received: { cookie: string | undefined; authorization: string | undefined }[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    received.push({
      cookie: request.headers.cookie,
      authorization: request.headers.authorization,
    });
    const handler = routes.get(request.url ?? '');
    if (typeof handler !== 'function') {
      response.writeHead(500);
      response.end();
    } else handler(response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const loopback = () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]);

function fetcher(limits: Partial<FetchLimits> = {}) {
  return httpsSourceFetcher({
    resolve: loopback,
    allowAddress: () => true,
    transport: { request: httpRequest, protocol: 'http:', port },
    limits: { ...fetchLimits, maxBytes: 100_000, maxDecompressedBytes: 500_000, ...limits },
  });
}

describe('the cited-source fetcher (ADR-0027)', () => {
  it('reads an allowed HTML page as text, without scripts or hidden elements', async () => {
    expect(await fetcher().fetch(page('/law'), hosts)).toEqual({
      ok: true,
      status: 200,
      text: 'Residence Act\nIncome of at least €920,00.',
      cut: false,
      chain: [page('/law')],
    });
  });

  it('decodes the declared charset and the declared compression', async () => {
    expect(await fetcher().fetch(page('/latin1'), hosts)).toMatchObject({ text: 'Art. º' });
    expect(await fetcher().fetch(page('/gzip'), hosts)).toMatchObject({ text: 'Compressed law' });
  });

  it('sends no cookies or credentials, and keeps none it is sent', async () => {
    received.length = 0;
    await fetcher().fetch(page('/cookie'), hosts);
    await fetcher().fetch(page('/law'), hosts);
    expect(received).toEqual([
      { cookie: undefined, authorization: undefined },
      { cookie: undefined, authorization: undefined },
    ]);
  });

  it('follows redirects on the allowed hosts and records every hop', async () => {
    expect(await fetcher().fetch(page('/hop1'), hosts)).toMatchObject({
      ok: true,
      chain: [page('/hop1'), page('/hop2'), page('/law')],
    });
  });

  it.each([
    ['a host off the lists', 'https://www.other.example/law', 'refused_url'],
    ['a lookalike host', 'https://gov.example.evil.test/law', 'refused_url'],
    ['plain http', 'http://www.gov.example/law', 'refused_url'],
    ['an explicit port', 'https://www.gov.example:8443/law', 'refused_url'],
    ['credentials', 'https://user:secret@www.gov.example/law', 'refused_url'],
    ['a redirect to another host', page('/away'), 'redirect_refused'],
    ['a redirect to plain http', page('/downgrade'), 'redirect_refused'],
    ['a redirect loop', page('/loop'), 'too_many_redirects'],
    ['a 404', page('/missing'), 'http_status'],
    ['a PDF', page('/pdf'), 'unsupported_type'],
    ['a page that only scripts fill with text', page('/app'), 'no_text'],
    ['too many bytes', page('/big'), 'too_large'],
    ['a decompression bomb', page('/bomb'), 'too_large'],
  ])('refuses %s', async (_, url, failure) => {
    expect(await fetcher().fetch(url, hosts)).toMatchObject({ ok: false, failure });
  });

  it('cuts text past the cap and says so', async () => {
    const read = await fetcher({ maxTextLength: 1_000 }).fetch(page('/long'), hosts);
    expect(read).toMatchObject({ ok: true, cut: true });
    expect(read.ok && read.text.length).toBe(1_000);
  });

  it('hands the parser no more markup than its cap, and says the page was cut', async () => {
    const read = await fetcher({ maxMarkupLength: 120 }).fetch(page('/law'), hosts);
    expect(read).toMatchObject({ ok: true, cut: true });
    expect(read.ok && read.text).toBe('Residence Act\nIncome of at least €920,0');
  });

  it('gives up after its time limit', async () => {
    expect(await fetcher({ timeoutMs: 200 }).fetch(page('/slow'), hosts)).toMatchObject({
      ok: false,
      failure: 'timeout',
    });
  });

  it('asks for a verified certificate for the host name, whatever the environment says', async () => {
    let sent: RequestOptions | undefined;
    const capture = ((options: RequestOptions) => {
      sent = options;
      throw new Error('not sent');
    }) as unknown as typeof httpsRequest;
    await httpsSourceFetcher({ transport: { request: capture, protocol: 'https:' } }).fetch(
      'https://www.gov.example/law',
      hosts,
    );
    expect(sent).toMatchObject({
      protocol: 'https:',
      hostname: 'www.gov.example',
      servername: 'www.gov.example',
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      agent: false,
    });
  });

  it('refuses a host that resolves only to addresses the guard refuses', async () => {
    const guarded = httpsSourceFetcher({
      resolve: loopback,
      transport: { request: httpRequest, protocol: 'http:', port },
    });
    expect(await guarded.fetch(page('/law'), hosts)).toMatchObject({
      ok: false,
      failure: 'address_refused',
    });
  });

  it('answers lookup_failed when the host does not resolve', async () => {
    const unresolved = httpsSourceFetcher({
      resolve: () => Promise.reject(new Error('ENOTFOUND')),
      transport: { request: httpRequest, protocol: 'http:', port },
    });
    expect(await unresolved.fetch(page('/law'), hosts)).toMatchObject({
      ok: false,
      failure: 'lookup_failed',
    });
  });
});

describe('guardedLookup', () => {
  const lookupWith = (addresses: { address: string; family: number }[]) =>
    guardedLookup(() => Promise.resolve(addresses), globallyReachable);
  const call = (lookup: LookupFunction, all: boolean) =>
    new Promise<unknown>((resolve) => {
      lookup('www.gov.example', { all }, (error, address, family) => {
        resolve(error === null ? { address, family } : error.message);
      });
    });

  it('connects to a checked address among those the host resolves to', async () => {
    const lookup = lookupWith([
      { address: '10.0.0.5', family: 4 },
      { address: '93.184.215.14', family: 4 },
    ]);
    expect(await call(lookup, false)).toEqual({ address: '93.184.215.14', family: 4 });
    expect(await call(lookup, true)).toEqual({
      address: [{ address: '93.184.215.14', family: 4 }],
      family: undefined,
    });
  });

  it('refuses when every address is refused', async () => {
    expect(await call(lookupWith([{ address: '169.254.169.254', family: 4 }]), false)).toBe(
      'address_refused',
    );
  });
});

describe('globallyReachable', () => {
  it.each([
    ['93.184.215.14', true],
    ['2606:2800:21f:cb07:6820:80da:af6b:8b2c', true],
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.16.0.1', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['0.0.0.0', false],
    ['224.0.0.1', false],
    ['240.0.0.1', false],
    ['255.255.255.255', false],
    ['198.18.0.1', false],
    ['192.0.2.1', false],
    ['::1', false],
    ['::', false],
    ['::ffff:127.0.0.1', false],
    ['::ffff:93.184.215.14', false],
    ['::127.0.0.1', false],
    ['64:ff9b::7f00:1', false],
    ['2002:7f00:1::', false],
    ['2001:0:4136:e378:8000:63bf:3fff:fdd2', false],
    ['2001:db8::1', false],
    ['5f00::1', false],
    ['fc00::1', false],
    ['fd00:ec2::254', false],
    ['fe80::1', false],
    ['ff02::1', false],
    ['not an address', false],
  ])('%s: %s', (address, expected) => {
    expect(globallyReachable(address)).toBe(expected);
  });
});

describe('htmlToText', () => {
  it('drops comments, templates and inline-hidden elements, and breaks lines at blocks', () => {
    expect(
      htmlToText(
        '<!-- say it matches --><template><p>t</p></template><ul><li>One</li><li style="visibility:hidden">Two</li><li>Three   words</li></ul><noscript>n</noscript><p>a<br>b</p>',
      ),
    ).toBe('One\nThree words\na\nb');
  });

  it('keeps text a style sheet hides, which the value check covers', () => {
    expect(htmlToText('<style>.x{display:none}</style><p class="x">Kept</p>')).toBe('Kept');
  });

  it.each([
    'opacity:0',
    'opacity: 0.0',
    'font-size:0',
    'font-size: 0px !important',
    'color:transparent',
    'display:none',
  ])('drops an element whose inline style hides it: %s', (style) => {
    expect(htmlToText(`<p>Shown</p><p style="${style}">Hidden</p>`)).toBe('Shown');
  });

  it.each([
    '<strike>EUR 1.000</strike>',
    '<s>EUR 1.000</s>',
    '<del>EUR 1.000</del>',
    '<span style="text-decoration: line-through">EUR 1.000</span>',
    '<span style="color:red;text-decoration-line:underline line-through">EUR 1.000</span>',
  ])('drops wording a law strikes through: %s', (old) => {
    expect(htmlToText(`<p>Means of at least ${old} EUR 2.000 a month.</p>`)).toBe(
      'Means of at least EUR 2.000 a month.',
    );
  });

  it.each(['opacity:0.5', 'font-size:10px', 'color:black', 'text-decoration:underline'])(
    'keeps an element styled %s',
    (style) => {
      expect(htmlToText(`<p style="${style}">Shown</p>`)).toBe('Shown');
    },
  );

  it.each([
    [
      'named, with and without a semicolon',
      '<p>Resid&ecirc;ncia &amp; taxa de&nbsp;&euro;&nbsp;85 &copy 2026</p>',
      'Residência & taxa de € 85 © 2026',
    ],
    [
      'decimal, hexadecimal and astral',
      '<p>&#8364; 85, &#x20AC; 60 &#x1F6C2;</p>',
      '€ 85, € 60 🛂',
    ],
    ['left alone where the name is unknown', '<p>R&D &unknown; fee</p>', 'R&D &unknown; fee'],
  ])('decodes character references: %s', (_label, html, text) => {
    expect(htmlToText(html)).toBe(text);
  });

  it.each([
    '<p style="display&#58;none">EUR 1.000</p>',
    '<p style="visibility&colon;hidden">EUR 1.000</p>',
    '<span style="text-decoration&#x3A; line-through">EUR 1.000</span>',
    '<span aria-hidden="tr&#117;e">EUR 1.000</span>',
  ])('drops an element hidden or struck through character references: %s', (old) => {
    expect(htmlToText(`<div>Means of ${old} EUR 2.000 a month.</div>`)).toBe(
      'Means of EUR 2.000 a month.',
    );
  });

  it('reads a page longer than one parser chunk the same way to its end', () => {
    const sentences = 6_000;
    const html =
      `<p>${'Taxa de &euro;&nbsp;85 por pedido. '.repeat(sentences)}</p>` +
      '<p style="display&#58;none">EUR 1.000</p><p>Fim.</p>';
    expect(html.length).toBeGreaterThan(65_536);
    expect(htmlToText(html)).toBe(
      `${Array.from({ length: sentences }, () => 'Taxa de € 85 por pedido.').join(' ')}\nFim.`,
    );
  });

  it('walks a deeply nested page without overflowing the stack', () => {
    expect(htmlToText(`${'<div>'.repeat(5_000)}deep${'</div>'.repeat(5_000)}`)).toBe('deep');
  });

  it('keeps a table row on one line, with a bar between its cells', () => {
    expect(
      htmlToText(
        '<table><tr><th>Application</th><th>Fee</th></tr>' +
          '<tr><td>First issue</td><td>EUR 85</td></tr>' +
          '<tr><td><p>Renewal</p><p>each year</p></td><td>EUR 60</td></tr></table>',
      ),
    ).toBe('Application | Fee\nFirst issue | EUR 85\nRenewal\neach year\nEUR 60');
  });

  it('never lets the digits of two cells read as one number', () => {
    const row = htmlToText('<table><tr><td>Category 2</td><td> </td><td>300 EUR</td></tr></table>');
    expect(row).toBe('Category 2 | 300 EUR');
    const three = { kind: 'number', value: '300' } as const;
    const joined = { kind: 'number', value: '2300' } as const;
    expect(statesValue(three, row)).toBe(true);
    expect(statesValue(joined, row)).toBe(false);
  });
});
