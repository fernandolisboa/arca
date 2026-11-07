import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns';
import type { IncomingMessage, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { hostMatches } from '@arca/domain';
import { globallyReachable } from './addresses.js';
import { htmlToText } from './html-text.js';

/** Why a cited page was not read. Fixed codes only: they reach the report and the logs. */
export const fetchFailures = [
  'refused_url',
  'redirect_refused',
  'too_many_redirects',
  'address_refused',
  'lookup_failed',
  'http_status',
  'unsupported_type',
  'too_large',
  'timeout',
  'network',
] as const;
export type FetchFailure = (typeof fetchFailures)[number];

export type FetchOutcome =
  | {
      readonly ok: true;
      readonly status: number;
      /** The page's text, capped; `cut` says whether the cap cut it. */
      readonly text: string;
      readonly cut: boolean;
      /** Every URL requested, the cited one first. */
      readonly chain: readonly string[];
    }
  | {
      readonly ok: false;
      readonly failure: FetchFailure;
      readonly status: number | null;
      readonly chain: readonly string[];
    };

/**
 * The `SourceFetcher` port (ADR-0027): reads one cited official page, allowed on `hosts` and their
 * subdomains only, every redirect hop included.
 */
export interface SourceFetcher {
  fetch(url: string, hosts: readonly string[]): Promise<FetchOutcome>;
}

export interface FetchLimits {
  /** Bytes received, before decompression. */
  readonly maxBytes: number;
  /** Bytes after decompression. */
  readonly maxDecompressedBytes: number;
  /** Characters of text kept; a law's section fits. */
  readonly maxTextLength: number;
  /** For the whole fetch, redirects included. */
  readonly timeoutMs: number;
  readonly maxRedirects: number;
}

export const fetchLimits: FetchLimits = {
  maxBytes: 3_000_000,
  maxDecompressedBytes: 6_000_000,
  maxTextLength: 60_000,
  timeoutMs: 20_000,
  maxRedirects: 3,
};

/** Every address a host resolves to; the guard picks among them. */
export type Resolve = (host: string) => Promise<readonly { address: string; family: number }[]>;

const systemResolve: Resolve = (host) =>
  new Promise((resolve, reject) => {
    dnsLookup(host, { all: true, order: 'verbatim' }, (error, addresses) => {
      if (error === null) resolve(addresses);
      else reject(error);
    });
  });

export interface FetcherSettings {
  readonly resolve?: Resolve;
  /** Whether an address may be connected to; tests of limits and redirects allow loopback. */
  readonly allowAddress?: (address: string) => boolean;
  /** `node:https` in production; a test may pass `node:http` with its local server's port. */
  readonly request?: typeof httpsRequest;
  readonly port?: number;
  readonly limits?: FetchLimits;
}

class FetchError extends Error {
  override name = 'FetchError';
  readonly failure: FetchFailure;
  readonly status: number | null;
  constructor(failure: FetchFailure, status: number | null = null) {
    super(failure);
    this.failure = failure;
    this.status = status;
  }
}

const redirects = new Set([301, 302, 303, 307, 308]);
const readable = new Set(['text/html', 'application/xhtml+xml', 'text/plain']);

/** An `https` URL with no credentials or port, on an allowed host, or undefined. */
function allowedUrl(url: string, hosts: readonly string[]): URL | undefined {
  if (!URL.canParse(url)) return undefined;
  const parsed = new URL(url);
  const plain =
    parsed.protocol === 'https:' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.port === '';
  return plain && hostMatches(parsed.hostname, hosts) ? parsed : undefined;
}

/**
 * A `lookup` for the request that asks for every address of the host and keeps only those the
 * guard allows, so the connection is made to an address that was checked, never re-resolved.
 */
export function guardedLookup(resolve: Resolve, allowAddress: (address: string) => boolean) {
  const lookup: LookupFunction = (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        const allowed = addresses.filter(({ address }) => allowAddress(address));
        const [first] = allowed;
        if (first === undefined) {
          callback(new FetchError('address_refused'), '', 4);
        } else if (options.all === true) {
          (callback as unknown as (error: null, all: typeof allowed) => void)(null, [first]);
        } else {
          callback(null, first.address, first.family);
        }
      },
      () => {
        callback(new FetchError('lookup_failed'), '', 4);
      },
    );
  };
  return lookup;
}

/** Counts bytes through a stream and stops it past a limit. */
function byteLimit(max: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      seen += chunk.length;
      if (seen > max) callback(new FetchError('too_large'));
      else callback(null, chunk);
    },
  });
}

function decoder(encoding: string | undefined): Transform | undefined {
  switch ((encoding ?? 'identity').trim().toLowerCase()) {
    case 'identity':
      return undefined;
    case 'gzip':
    case 'x-gzip':
      return createGunzip();
    case 'deflate':
      return createInflate();
    case 'br':
      return createBrotliDecompress();
    default:
      throw new FetchError('unsupported_type');
  }
}

function contentType(response: IncomingMessage): { type: string; charset: string } {
  const [type = '', ...parameters] = (response.headers['content-type'] ?? '').split(';');
  const charset = parameters
    .map((parameter) => parameter.trim().split('='))
    .find(([name]) => name?.toLowerCase() === 'charset')?.[1];
  return {
    type: type.trim().toLowerCase(),
    charset: (charset ?? 'utf-8').replace(/^"|"$/g, ''),
  };
}

/**
 * The `node:https` adapter of the port (ADR-0027): a `GET` with no cookies or credentials, at most
 * three redirect hops each checked against the allowed hosts, every connection made to an address
 * the guard checked, with the certificate verified against the host name, and limits on bytes,
 * decompressed size, time and text. Only a final 2xx HTML or plain-text page is read.
 */
export function httpsSourceFetcher({
  resolve = systemResolve,
  allowAddress = globallyReachable,
  request = httpsRequest,
  port,
  limits = fetchLimits,
}: FetcherSettings = {}): SourceFetcher {
  const lookup = guardedLookup(resolve, allowAddress);

  const get = (url: URL, signal: AbortSignal) =>
    new Promise<IncomingMessage>((resolveResponse, reject) => {
      const options: RequestOptions = {
        method: 'GET',
        protocol: request === httpsRequest ? 'https:' : 'http:',
        hostname: url.hostname,
        ...(port === undefined ? {} : { port }),
        path: `${url.pathname}${url.search}`,
        headers: {
          accept: 'text/html, application/xhtml+xml, text/plain;q=0.8',
          'accept-encoding': 'gzip, deflate, br',
          'user-agent': 'Arca-rule-check/1',
        },
        lookup,
        agent: false,
        signal,
      };
      const sent = request(options, resolveResponse);
      sent.on('error', reject);
      sent.end();
    });

  const body = async (response: IncomingMessage, charset: string): Promise<string> => {
    let text: TextDecoder;
    try {
      text = new TextDecoder(charset, { fatal: false });
    } catch {
      throw new FetchError('unsupported_type', response.statusCode ?? null);
    }
    const chunks: Buffer[] = [];
    const collect = new Transform({
      transform(chunk: Buffer, _encoding, callback: TransformCallback) {
        chunks.push(chunk);
        callback();
      },
    });
    const decompress = decoder(response.headers['content-encoding']);
    await pipeline([
      response,
      byteLimit(limits.maxBytes),
      ...(decompress === undefined ? [] : [decompress]),
      byteLimit(limits.maxDecompressedBytes),
      collect,
    ]);
    return text.decode(Buffer.concat(chunks));
  };

  const read = async (
    cited: string,
    hosts: readonly string[],
    chain: string[],
    signal: AbortSignal,
  ) => {
    let url = allowedUrl(cited, hosts);
    for (let hop = 0; url !== undefined; hop += 1) {
      const current: URL = url;
      const response = await get(current, signal);
      const status = response.statusCode ?? 0;
      if (redirects.has(status)) {
        response.resume();
        if (hop >= limits.maxRedirects) throw new FetchError('too_many_redirects', status);
        const location = response.headers.location;
        url =
          location === undefined || !URL.canParse(location, current)
            ? undefined
            : allowedUrl(new URL(location, current).href, hosts);
        if (url === undefined) throw new FetchError('redirect_refused', status);
        chain.push(url.href);
        continue;
      }
      if (status < 200 || status > 299) {
        response.resume();
        throw new FetchError('http_status', status);
      }
      const { type, charset } = contentType(response);
      if (!readable.has(type)) {
        response.resume();
        throw new FetchError('unsupported_type', status);
      }
      const raw = await body(response, charset);
      const full = type === 'text/plain' ? raw : htmlToText(raw);
      const cut = full.length > limits.maxTextLength;
      return { status, text: cut ? full.slice(0, limits.maxTextLength) : full, cut };
    }
    throw new FetchError('refused_url');
  };

  return {
    async fetch(cited, hosts) {
      const chain = [cited];
      const signal = AbortSignal.timeout(limits.timeoutMs);
      try {
        const page = await read(cited, hosts, chain, signal);
        return { ok: true, ...page, chain };
      } catch (error) {
        if (error instanceof FetchError) {
          return { ok: false, failure: error.failure, status: error.status, chain };
        }
        const failure = signal.aborted ? 'timeout' : 'network';
        return { ok: false, failure, status: null, chain };
      }
    },
  };
}

/** The SHA-256 of a text, as the fetch log records the text sent for a page. */
export function textDigest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
