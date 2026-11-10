import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns';
import type { IncomingMessage } from 'node:http';
import { type RequestOptions, request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { type FetchFailure, hostMatches } from '@arca/domain';
import { globallyReachable } from './addresses.js';
import { type AnswerFormat, answerFormat, answerText } from './answer-text.js';

export type FetchOutcome =
  | {
      readonly ok: true;
      readonly status: number;
      /** The page's text, capped; `cut` says whether the cap cut it. */
      readonly text: string;
      readonly cut: boolean;
      /** Every URL requested, the one asked for first. */
      readonly chain: readonly string[];
    }
  | {
      readonly ok: false;
      readonly failure: FetchFailure;
      readonly status: number | null;
      readonly chain: readonly string[];
    };

/**
 * The `SourceFetcher` port (ADR-0027): reads one cited official page, or the machine-readable
 * address its source names, allowed on `hosts` and their subdomains only, every redirect hop
 * included.
 */
export interface SourceFetcher {
  fetch(url: string, hosts: readonly string[]): Promise<FetchOutcome>;
}

export interface FetchLimits {
  /** Bytes received, before decompression. */
  readonly maxBytes: number;
  /** Bytes after decompression. */
  readonly maxDecompressedBytes: number;
  /** Characters of markup or data handed to a parser; more is cut, as the text would be. */
  readonly maxMarkupLength: number;
  /** Characters of text kept; a whole code fits, and the check sends a long page as an excerpt. */
  readonly maxTextLength: number;
  /** For the whole fetch, redirects included. */
  readonly timeoutMs: number;
  readonly maxRedirects: number;
}

export const fetchLimits: FetchLimits = {
  maxBytes: 3_000_000,
  maxDecompressedBytes: 6_000_000,
  maxMarkupLength: 6_000_000,
  maxTextLength: 3_000_000,
  timeoutMs: 20_000,
  maxRedirects: 3,
};

/** A page's text within the per-page cap, and whether the cap cut it. */
function capText(
  full: string,
  maxLength = fetchLimits.maxTextLength,
): { readonly text: string; readonly cut: boolean } {
  return { text: full.slice(0, maxLength), cut: full.length > maxLength };
}

/**
 * An answer's text within the limits and whether they cut it, or undefined when it has no text: a
 * page that draws its text with scripts answers markup with nothing a reader would see, and a data
 * answer that does not parse has no strings.
 */
export function textWithinLimits(
  format: AnswerFormat,
  raw: string,
  limits: Pick<FetchLimits, 'maxMarkupLength' | 'maxTextLength'> = fetchLimits,
): { readonly text: string; readonly cut: boolean } | undefined {
  const markupCut = format !== 'plain' && raw.length > limits.maxMarkupLength;
  const full = answerText(format, markupCut ? raw.slice(0, limits.maxMarkupLength) : raw);
  if (full.trim() === '') return undefined;
  const capped = capText(full, limits.maxTextLength);
  return { text: capped.text, cut: markupCut || capped.cut };
}

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
  readonly transport?: Transport;
  readonly limits?: FetchLimits;
}

/** How a request leaves: the client, the protocol it speaks and, for a local test server, a port. */
export interface Transport {
  readonly request: typeof httpsRequest;
  readonly protocol: 'https:' | 'http:';
  readonly port?: number;
}

const httpsTransport: Transport = { request: httpsRequest, protocol: 'https:' };

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
 * decompressed size, time and text. Only a final 2xx answer with some text is read: an HTML or
 * plain-text page, or a JSON or XML answer from a machine-readable address.
 */
export function httpsSourceFetcher({
  resolve = systemResolve,
  allowAddress = globallyReachable,
  transport: { request, protocol, port } = httpsTransport,
  limits = fetchLimits,
}: FetcherSettings = {}): SourceFetcher {
  const lookup = guardedLookup(resolve, allowAddress);

  const get = (url: URL, signal: AbortSignal) =>
    new Promise<IncomingMessage>((resolveResponse, reject) => {
      const options: RequestOptions = {
        method: 'GET',
        protocol,
        hostname: url.hostname,
        ...(port === undefined ? {} : { port }),
        path: `${url.pathname}${url.search}`,
        headers: {
          accept:
            'text/html, application/xhtml+xml, application/json;q=0.9, application/xml;q=0.9, text/xml;q=0.9, text/plain;q=0.8, */*;q=0.1',
          'accept-encoding': 'gzip, deflate, br',
          'user-agent': 'Arca-rule-check/1',
        },
        lookup,
        agent: false,
        // Explicit, so no environment variable can turn verification off for these pages.
        rejectUnauthorized: true,
        servername: url.hostname,
        minVersion: 'TLSv1.2',
        signal,
      };
      const sent = request(options, resolveResponse);
      sent.on('error', reject);
      sent.end();
    });

  const body = async (response: IncomingMessage, charset: string): Promise<string> => {
    let text: TextDecoder;
    let decompress: Transform | undefined;
    try {
      text = new TextDecoder(charset, { fatal: false });
      decompress = decoder(response.headers['content-encoding']);
    } catch (error) {
      // Nothing will read the body, so the socket closes now rather than at the time limit.
      response.destroy();
      if (error instanceof FetchError) throw error;
      throw new FetchError('unsupported_type', response.statusCode ?? null);
    }
    const chunks: Buffer[] = [];
    const collect = new Transform({
      transform(chunk: Buffer, _encoding, callback: TransformCallback) {
        chunks.push(chunk);
        callback();
      },
    });
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
      const format = answerFormat(type);
      if (format === undefined) {
        // Nothing will read the body, so the socket closes now rather than at the time limit.
        response.destroy();
        throw new FetchError('unsupported_type', status);
      }
      const read = textWithinLimits(format, await body(response, charset), limits);
      if (read === undefined) throw new FetchError('no_text', status);
      return { status, ...read };
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
