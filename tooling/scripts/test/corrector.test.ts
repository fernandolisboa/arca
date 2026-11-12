import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type CorrectorClient,
  CorrectorError,
  correctorClient,
  correctorKeyPattern,
  maxExplanation,
  maxFileBytes,
  paths,
  productionOrigin,
  propose,
  run,
} from '../src/corrector.ts';

const key = `arca_ck_${'a'.repeat(43)}`;
const requestId = '0b5f5d3c-6a1e-4b8e-9d6f-2a3b4c5d6e7f';
const blobUrl = 'https://store1.private.blob.vercel-storage.com/corrections/x?download=1';

interface Sent {
  readonly url: string;
  readonly init: RequestInit;
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeFetch(answer: (url: string) => Response): { fetchUrl: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetchUrl: typeof fetch = (input, init = {}) => {
    const url = input instanceof Request ? input.url : input.toString();
    sent.push({ url, init });
    return Promise.resolve(answer(url));
  };
  return { fetchUrl, sent };
}

const headersOf = (sent: Sent | undefined) => new Headers(sent?.init.headers);
const bodyOf = (sent: Sent | undefined): unknown =>
  typeof sent?.init.body === 'string' ? JSON.parse(sent.init.body) : undefined;

describe('the corrector script (ADR-0029)', () => {
  it('refuses a missing or malformed key without echoing it', () => {
    for (const bad of ['', 'arca_ck_short', `xarca_ck_${'a'.repeat(43)}`]) {
      expect(() => correctorClient(bad)).toThrow(
        'ARCA_CORRECTOR_KEY is missing or is not a corrector key',
      );
    }
  });

  it('lists requests from the production origin with the key and no Origin', async () => {
    const { fetchUrl, sent } = fakeFetch(() => jsonResponse(200, { requests: [] }));
    await expect(correctorClient(key, { fetchUrl }).list()).resolves.toEqual({ requests: [] });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`${productionOrigin}${paths.list}`);
    expect(sent[0]?.init.method).toBe('GET');
    expect(sent[0]?.init.redirect).toBe('error');
    expect(headersOf(sent[0]).get('authorization')).toBe(`Bearer ${key}`);
    expect(headersOf(sent[0]).get('origin')).toBeNull();
    expect(headersOf(sent[0]).get('sec-fetch-site')).toBeNull();
  });

  it('sends the production Origin and a JSON body on an answer', async () => {
    const { fetchUrl, sent } = fakeFetch(() => jsonResponse(200, {}));
    await expect(
      correctorClient(key, { fetchUrl }).answer(requestId, { kind: 'taken' }),
    ).resolves.toBe('stored');
    expect(sent[0]?.url).toBe(`${productionOrigin}${paths.answer}`);
    expect(sent[0]?.init.method).toBe('POST');
    expect(headersOf(sent[0]).get('origin')).toBe(productionOrigin);
    expect(bodyOf(sent[0])).toEqual({
      requestId,
      answer: { kind: 'taken' },
    });
  });

  it.each([
    [404, { error: { code: 'not_found' } }, 'not_found'],
    [409, { error: { code: 'wrong_state' } }, 'wrong_state'],
    [409, { error: { code: 'invalid_version' } }, 'invalid_version'],
  ] as const)('maps %i %j to %s', async (status, body, outcome) => {
    const { fetchUrl } = fakeFetch(() => jsonResponse(status, body));
    await expect(
      correctorClient(key, { fetchUrl }).answer(requestId, { kind: 'taken' }),
    ).resolves.toBe(outcome);
  });

  it('reports any other failure by route, status and code only', async () => {
    const { fetchUrl } = fakeFetch(() => jsonResponse(401, { error: { code: 'unauthorized' } }));
    const failure = correctorClient(key, { fetchUrl }).list();
    await expect(failure).rejects.toThrow(`${paths.list}: answered 401 unauthorized`);
    await expect(failure).rejects.not.toThrow(key);
  });

  it('never reports an error code that is not a short identifier', async () => {
    const { fetchUrl } = fakeFetch(() => jsonResponse(500, { error: { code: `leak ${key}` } }));
    await expect(correctorClient(key, { fetchUrl }).list()).rejects.toThrow(
      new CorrectorError(`${paths.list}: answered 500`),
    );
  });

  it('downloads a file from the Blob URL the API minted, without the key', async () => {
    const { fetchUrl, sent } = fakeFetch((url) =>
      url.startsWith(productionOrigin)
        ? jsonResponse(200, { url: blobUrl })
        : new Response(new Uint8Array([1, 2, 3])),
    );
    const bytes = await correctorClient(key, { fetchUrl }).file(requestId, 2);
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(bodyOf(sent[0])).toEqual({ requestId, position: 2 });
    expect(sent[1]?.url).toBe(blobUrl);
    expect(sent[1]?.init.headers).toBeUndefined();
    expect(sent[1]?.init.redirect).toBe('error');
  });

  it.each([
    'http://store1.private.blob.vercel-storage.com/x',
    'https://evil.example/x',
    'https://blob.vercel-storage.com.evil.example/x',
    'https://store1.private.blob.vercel-storage.com:8443/x',
    'https://user@store1.private.blob.vercel-storage.com/x',
    'not a url',
  ])('refuses to download from %s', async (url) => {
    const { fetchUrl, sent } = fakeFetch(() => jsonResponse(200, { url }));
    await expect(correctorClient(key, { fetchUrl }).file(requestId, 0)).rejects.toThrow(
      'not a Blob store URL',
    );
    expect(sent).toHaveLength(1);
  });

  it('keeps proposing while production does not serve the version yet', async () => {
    const outcomes = ['invalid_version', 'invalid_version', 'stored'] as const;
    const answers: unknown[] = [];
    const waits: number[] = [];
    const client: CorrectorClient = {
      list: () => Promise.reject(new Error('unused')),
      file: () => Promise.reject(new Error('unused')),
      answer: (_id, answer) => {
        answers.push(answer);
        return Promise.resolve(outcomes[answers.length - 1] ?? 'stored');
      },
    };
    const wait = (ms: number) => Promise.resolve(waits.push(ms));
    await expect(propose(client, requestId, 4, { waitMs: 5, wait })).resolves.toBe('stored');
    expect(answers).toEqual(Array(3).fill({ kind: 'version_proposed', number: 4 }));
    expect(waits).toEqual([5, 5]);
  });

  it('waits ten minutes by default before the refusal stands', async () => {
    const waits: number[] = [];
    const client: CorrectorClient = {
      list: () => Promise.reject(new Error('unused')),
      file: () => Promise.reject(new Error('unused')),
      answer: () => Promise.resolve('invalid_version'),
    };
    const wait = (ms: number) => Promise.resolve(waits.push(ms));
    await expect(propose(client, requestId, 4, { wait })).resolves.toBe('invalid_version');
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBe(10 * 60_000);
  });

  it('stops proposing after the last attempt, or at once on another refusal', async () => {
    let calls = 0;
    const client = (outcome: 'invalid_version' | 'wrong_state'): CorrectorClient => ({
      list: () => Promise.reject(new Error('unused')),
      file: () => Promise.reject(new Error('unused')),
      answer: () => Promise.resolve(((calls += 1), outcome)),
    });
    const wait = () => Promise.resolve();
    await expect(
      propose(client('invalid_version'), requestId, 4, { attempts: 3, wait }),
    ).resolves.toBe('invalid_version');
    expect(calls).toBe(3);
    calls = 0;
    await expect(propose(client('wrong_state'), requestId, 4, { wait })).resolves.toBe(
      'wrong_state',
    );
    expect(calls).toBe(1);
  });
});

describe('pnpm corrector', () => {
  const recorder = () => {
    const answers: unknown[] = [];
    const client: CorrectorClient = {
      list: () => Promise.resolve({ requests: [] }),
      file: () => Promise.resolve(new Uint8Array([7])),
      answer: (id, answer) => (answers.push({ id, answer }), Promise.resolve('stored')),
    };
    let out = '';
    return {
      answers,
      client: () => client,
      write: (text: string) => (out += text),
      out: () => out,
    };
  };

  it('takes a request and answers no_change from a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'corrector-'));
    const explanation = join(dir, 'why.txt');
    await writeFile(explanation, '  Procurei no BOE e nada mudou.\n');
    const { answers, client, write, out } = recorder();
    await expect(run(['take', requestId], client, write)).resolves.toBe(true);
    await expect(run(['no-change', requestId, explanation], client, write)).resolves.toBe(true);
    expect(answers).toEqual([
      { id: requestId, answer: { kind: 'taken' } },
      {
        id: requestId,
        answer: { kind: 'no_change', explanation: 'Procurei no BOE e nada mudou.' },
      },
    ]);
    expect(out()).toBe('stored\nstored\n');
  });

  it('refuses an empty or too long explanation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'corrector-'));
    const { client, write } = recorder();
    for (const text of [' \n', 'x'.repeat(2_001)]) {
      const file = join(dir, `e${String(text.length)}.txt`);
      await writeFile(file, text);
      await expect(run(['no-change', requestId, file], client, write)).rejects.toThrow(
        '1 to 2,000 characters',
      );
    }
  });

  it('saves a file only where none exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'corrector-'));
    const target = join(dir, 'copy.pdf');
    const { client, write } = recorder();
    await expect(run(['file', requestId, '1', target], client, write)).resolves.toBe(true);
    expect([...(await readFile(target))]).toEqual([7]);
    await expect(run(['file', requestId, '1', target], client, write)).rejects.toThrow('EEXIST');
  });

  it.each([
    [[]],
    [['take', 'not-a-uuid']],
    [['propose', requestId, '0']],
    [['propose', requestId, '1.5']],
    [['file', requestId, '-1', 'x']],
    [['delete', requestId]],
  ])('prints the usage for %j', async (args) => {
    const { client, write } = recorder();
    await expect(run(args, client, write)).rejects.toThrow('Usage, with ARCA_CORRECTOR_KEY set');
  });

  it('matches the key format and the routes of the API contract', async () => {
    const contract = await readFile(
      new URL('../../../packages/api-contract/src/routes/knowledge.ts', import.meta.url),
      'utf8',
    );
    expect(contract).toContain(
      `export const correctorKeyPattern = ${String(correctorKeyPattern)};`,
    );
    expect(contract).toContain(
      `export const maxCorrectionExplanation = ${maxExplanation.toLocaleString('en').replace(',', '_')};`,
    );
    expect(maxFileBytes).toBe(16 * 1024 * 1024);
    expect(contract).toContain('fileBytes: 16 * 1024 * 1024,');
    for (const path of Object.values(paths)) {
      expect(contract).toContain(`path: '${path.replace(/^\/v1/, '')}',`);
    }
    const site = await readFile(
      new URL('../../../apps/api/src/production-site.ts', import.meta.url),
      'utf8',
    );
    expect(site).toContain(`host: '${new URL(productionOrigin).host}',`);
  });
});
