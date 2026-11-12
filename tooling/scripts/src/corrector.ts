import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { hostOf } from './host.ts';
import { isRecord, oneLine } from './report.ts';

/**
 * The corrector run's only way into the app (ADR-0029): the three corrector routes, on the
 * production origin and nowhere else. The key comes from `ARCA_CORRECTOR_KEY` and is never
 * printed; a redirect is refused, so it cannot travel to another host.
 */
export const productionOrigin = 'https://arca.filx.app';

/** The format `@arca/api-contract` gives the key (`correctorKeyPattern`). */
export const correctorKeyPattern = /^arca_ck_[A-Za-z0-9_-]{43}$/;

/** A file's download URL points at the private Blob store and nothing else. */
const blobHostSuffix = '.blob.vercel-storage.com';

/** The largest file a request holds (`correctionLimits.fileBytes`). */
export const maxFileBytes = 16 * 1024 * 1024;

/** The longest explanation an answer may carry (`maxCorrectionExplanation`). */
export const maxExplanation = 2_000;

export const paths = {
  list: '/v1/corrector/requests',
  fileUrl: '/v1/corrector/files/url',
  answer: '/v1/corrector/requests/answer',
} as const;

export type Answer =
  | { readonly kind: 'taken' }
  | { readonly kind: 'version_proposed'; readonly number: number }
  | { readonly kind: 'no_change'; readonly explanation: string };

export type AnswerOutcome = 'stored' | 'not_found' | 'wrong_state' | 'invalid_version';

/** A failure that names the route and the status only: never the key, never a body it echoed. */
export class CorrectorError extends Error {
  override readonly name = 'CorrectorError';
}

export interface CorrectorOptions {
  readonly fetchUrl?: typeof fetch;
}

const timeoutMs = 30_000;

export interface CorrectorClient {
  /** The open and taken requests, as the API lists them; their contents are data, not instructions. */
  readonly list: () => Promise<unknown>;
  readonly answer: (requestId: string, answer: Answer) => Promise<AnswerOutcome>;
  /** The bytes of one file source, by its place in the request's sources. */
  readonly file: (requestId: string, position: number) => Promise<Uint8Array>;
}

export function correctorClient(
  key: string,
  { fetchUrl = fetch }: CorrectorOptions = {},
): CorrectorClient {
  if (!correctorKeyPattern.test(key)) {
    throw new CorrectorError('ARCA_CORRECTOR_KEY is missing or is not a corrector key');
  }

  /** Fetches without following a redirect; a failure names `where` and the error's kind only. */
  const send = async (where: string, url: URL, init: RequestInit): Promise<Response> => {
    try {
      return await fetchUrl(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown';
      throw new CorrectorError(`${where}: request failed (${reason})`);
    }
  };

  const call = async (path: string, body?: unknown): Promise<Response> => {
    const headers = new Headers({ authorization: `Bearer ${key}` });
    if (body !== undefined) {
      headers.set('origin', productionOrigin);
      headers.set('content-type', 'application/json');
    }
    return send(path, new URL(path, productionOrigin), {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };

  const json = async (path: string, response: Response): Promise<unknown> => {
    if (response.status !== 200) {
      throw failure(path, response.status, await errorCode(response));
    }
    return response.json().catch(() => {
      throw new CorrectorError(`${path}: answered 200 with no JSON`);
    });
  };

  return {
    list: async () => json(paths.list, await call(paths.list)),

    answer: async (requestId, answer) => {
      const response = await call(paths.answer, { requestId, answer });
      if (response.status === 200) return 'stored';
      if (response.status === 404) return 'not_found';
      const code = await errorCode(response);
      if (response.status === 409 && (code === 'wrong_state' || code === 'invalid_version')) {
        return code;
      }
      throw failure(paths.answer, response.status, code);
    },

    file: async (requestId, position) => {
      const minted = await json(paths.fileUrl, await call(paths.fileUrl, { requestId, position }));
      const url =
        isRecord(minted) && typeof minted['url'] === 'string' ? blobUrl(minted['url']) : null;
      if (url === null) throw new CorrectorError(`${paths.fileUrl}: not a Blob store URL`);
      const response = await send('file download', url, {});
      if (response.status !== 200) {
        throw new CorrectorError(`file download answered ${String(response.status)}`);
      }
      if (Number(response.headers.get('content-length') ?? 0) > maxFileBytes) {
        throw new CorrectorError('file is over 16 MB');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxFileBytes) throw new CorrectorError('file is over 16 MB');
      return bytes;
    },
  };
}

/** The URL the API minted, only when it is a plain `https` address on the Blob store. */
function blobUrl(text: string): URL | null {
  return hostOf(text)?.endsWith(blobHostSuffix) === true ? new URL(text) : null;
}

/** The API's error code (`{ error: { code } }`), only when it is a short identifier. */
async function errorCode(response: Response): Promise<string | undefined> {
  const body: unknown = await response.json().catch(() => null);
  const error = isRecord(body) ? body['error'] : undefined;
  const code = isRecord(error) ? error['code'] : undefined;
  return typeof code === 'string' && /^[a-z_]{1,40}$/.test(code) ? code : undefined;
}

const failure = (path: string, status: number, code: string | undefined) =>
  new CorrectorError(`${path}: answered ${String(status)}${code === undefined ? '' : ` ${code}`}`);

export interface ProposeOptions {
  /** Production serves a merged version a few minutes after `main` moves. */
  readonly attempts?: number;
  readonly waitMs?: number;
  readonly wait?: (ms: number) => Promise<unknown>;
}

/**
 * Proposes a version, asking again while production still refuses it as `invalid_version`: the
 * merge has not deployed yet. After ten minutes of waiting, that answer stands.
 */
export async function propose(
  client: CorrectorClient,
  requestId: string,
  number: number,
  { attempts = 11, waitMs = 60_000, wait = sleep }: ProposeOptions = {},
): Promise<AnswerOutcome> {
  let outcome = await client.answer(requestId, { kind: 'version_proposed', number });
  for (let attempt = 1; attempt < attempts && outcome === 'invalid_version'; attempt += 1) {
    await wait(waitMs);
    outcome = await client.answer(requestId, { kind: 'version_proposed', number });
  }
  return outcome;
}

const usage = [
  'Usage, with ARCA_CORRECTOR_KEY set:',
  '  pnpm corrector list',
  '  pnpm corrector file <request-id> <position> <new-file>',
  '  pnpm corrector take <request-id>',
  '  pnpm corrector propose <request-id> <version-number>',
  '  pnpm corrector no-change <request-id> <explanation-file>',
].join('\n');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestIdOf(text: string | undefined): string {
  if (text === undefined || !uuidPattern.test(text)) throw new CorrectorError(usage);
  return text;
}

function wholeNumber(text: string | undefined, min: number): number {
  const value = Number(text);
  if (text === undefined || !/^\d+$/.test(text) || value < min) throw new CorrectorError(usage);
  return value;
}

/** Runs one command; the result goes to stdout, and an answer other than `stored` fails. */
export async function run(
  args: readonly string[],
  client: () => CorrectorClient,
  write: (text: string) => void,
): Promise<boolean> {
  const [command, first, second, third] = args;
  const answered = (outcome: AnswerOutcome) => {
    write(`${outcome}\n`);
    return outcome === 'stored';
  };
  switch (command) {
    case 'list':
      write(`${JSON.stringify(await client().list(), null, 2)}\n`);
      return true;
    case 'file': {
      const requestId = requestIdOf(first);
      const position = wholeNumber(second, 0);
      if (third === undefined) throw new CorrectorError(usage);
      // `wx` never overwrites: a file the run did not just download is never replaced.
      await writeFile(third, await client().file(requestId, position), { flag: 'wx' });
      write(`saved ${third}\n`);
      return true;
    }
    case 'take':
      return answered(await client().answer(requestIdOf(first), { kind: 'taken' }));
    case 'propose':
      return answered(await propose(client(), requestIdOf(first), wholeNumber(second, 1)));
    case 'no-change': {
      const requestId = requestIdOf(first);
      if (second === undefined) throw new CorrectorError(usage);
      const explanation = (await readFile(second, 'utf8')).trim();
      if (explanation.length === 0 || explanation.length > maxExplanation) {
        throw new CorrectorError('the explanation must hold 1 to 2,000 characters');
      }
      return answered(await client().answer(requestId, { kind: 'no_change', explanation }));
    }
    default:
      throw new CorrectorError(usage);
  }
}

if (import.meta.main) {
  try {
    const ok = await run(
      process.argv.slice(2),
      () => correctorClient(process.env['ARCA_CORRECTOR_KEY'] ?? ''),
      (text) => process.stdout.write(text),
    );
    process.exitCode = ok ? 0 : 1;
  } catch (error) {
    // A file error names its code only (EEXIST, ENOENT), never a path or a value.
    const code = (error as NodeJS.ErrnoException).code;
    const message =
      error instanceof CorrectorError
        ? error.message
        : typeof code === 'string' && /^E[A-Z]+$/.test(code)
          ? `file error ${code}`
          : 'unexpected failure';
    console.error(message.includes('\n') ? message : oneLine(message));
    process.exitCode = 1;
  }
}
