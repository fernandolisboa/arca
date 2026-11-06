import { describe, expect, it } from 'vitest';
import { claudeExtractor } from '../src/intake/claude-extractor.js';
import { ExtractorError } from '../src/intake/extractor.js';
import { intakeModel } from '../src/intake/model.js';
import { intakePromptVersion } from '../src/intake/prompt.js';

// The Claude adapter against a fake HTTP client (spec 0008, R1). Synthetic text only.
const masked = 'Eu e minha esposa [P1] nascemos em 1985. Telefone [número].';
const draft = { people: [{ ref: '[P1]', role: 'spouse', birthDate: '1985' }], relationships: [] };
const secret = 'texto-do-membro-que-nao-pode-vazar';

const message = (text: string) =>
  Response.json({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: intakeModel,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 321, output_tokens: 45 },
  });

function fakeFetch(
  answer: (body: Record<string, unknown>, signal?: AbortSignal) => Promise<Response>,
) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    bodies.push(body);
    return answer(body, init?.signal ?? undefined);
  }) as typeof globalThis.fetch;
  return { fetch, bodies };
}

/** The error an adapter call throws. */
async function failure(promise: Promise<unknown>): Promise<ExtractorError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ExtractorError) return error;
    throw error;
  }
  throw new Error('the call did not fail');
}

describe('the Claude extractor (spec 0008, R1)', () => {
  it('sends one structured-output call with no tools and answers the reply with its usage', async () => {
    const { fetch, bodies } = fakeFetch(() => Promise.resolve(message(JSON.stringify(draft))));
    const reply = await claudeExtractor({ apiKey: 'test-key', fetch }).draft(masked, ['[P1]']);
    expect(reply).toEqual({
      reply: draft,
      model: intakeModel,
      promptVersion: intakePromptVersion,
      inputTokens: 321,
      outputTokens: 45,
    });
    expect(bodies).toHaveLength(1);
    const [body] = bodies;
    expect(body?.['model']).toBe(intakeModel);
    expect(body?.['max_tokens']).toBe(2_048);
    expect(body?.['tools']).toBeUndefined();
    expect(body?.['output_config']).toMatchObject({ format: { type: 'json_schema' } });
    expect(JSON.stringify(body?.['messages'])).toContain('[P1]');
  });

  it.each([
    [
      'a server error',
      () => Promise.resolve(new Response(secret, { status: 500 })),
      'intake_unavailable',
    ],
    [
      'an overloaded API',
      () => Promise.resolve(Response.json({ error: secret }, { status: 529 })),
      'intake_unavailable',
    ],
    [
      'a network failure',
      () =>
        Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: new Error(secret) })),
      'intake_unavailable',
    ],
    [
      'a reply that is not JSON',
      () => Promise.resolve(message(`${secret} {`)),
      'intake_unparsable',
    ],
    [
      'a malformed body',
      () => Promise.resolve(new Response(`{"${secret}"`, { status: 200 })),
      'intake_unavailable',
    ],
    ['a programming error', () => Promise.reject(new RangeError(secret)), 'intake_failed'],
  ] as const)('turns %s into a fixed code with nothing of the call', async (_, answer, code) => {
    const { fetch, bodies } = fakeFetch(answer);
    const error = await failure(claudeExtractor({ apiKey: 'test-key', fetch }).draft(masked, []));
    expect(error.code).toBe(code);
    expect(error.message).toBe(code);
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(String(error.stack)).not.toContain(secret);
    expect(String(error.stack)).not.toContain('[número]');
    // No retry inside the SDK: the API owns the one retry.
    expect(bodies).toHaveLength(1);
  });

  it('gives up at its timeout', async () => {
    const { fetch } = fakeFetch(
      (_, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const error = await failure(
      claudeExtractor({ apiKey: 'test-key', fetch, timeoutMs: 20 }).draft(masked, []),
    );
    expect(error.code).toBe('intake_timeout');
  });
});
