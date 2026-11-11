import { cachedSystemBlock } from './cached-system-block.js';
import { describe, expect, it } from 'vitest';
import { claudeSummarizer } from '../src/knowledge/summary/claude-summarizer.js';
import { ruleSummaryModel } from '../src/knowledge/summary/model.js';
import {
  ruleSummaryInstructions,
  ruleSummaryPromptVersion,
} from '../src/knowledge/summary/prompt.js';
import { SummarizerError } from '../src/knowledge/summary/summarizer.js';

// The Claude adapter of the rule summary against a fake HTTP client (ADR-0025).
const content = JSON.stringify({ title: 'Visto de teste', requirements: [] });
const summary = { overview: 'Um visto de teste.', watchPoints: ['Confira a fonte.'] };
const secret = 'resposta-que-nao-pode-vazar';

const message = (text: string) =>
  Response.json({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: ruleSummaryModel,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 2_100, output_tokens: 300 },
  });

function fakeFetch(answer: () => Promise<Response>) {
  const bodies: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(url instanceof Request ? url.url : String(url));
    bodies.push(JSON.parse(init?.body as string) as Record<string, unknown>);
    return answer();
  }) as typeof globalThis.fetch;
  return { fetch, bodies, urls };
}

async function failure(promise: Promise<unknown>): Promise<SummarizerError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SummarizerError) return error;
    throw error;
  }
  throw new Error('the call did not fail');
}

describe('the Claude summarizer (ADR-0025)', () => {
  it('sends one structured-output call with no tools and answers the reply with its usage', async () => {
    const { fetch, bodies, urls } = fakeFetch(() =>
      Promise.resolve(message(JSON.stringify(summary))),
    );
    const reply = await claudeSummarizer({ apiKey: 'test-key', fetch }).summarize(content);
    expect(reply).toEqual({
      reply: summary,
      model: ruleSummaryModel,
      promptVersion: ruleSummaryPromptVersion,
      inputTokens: 2_100,
      outputTokens: 300,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(urls).toEqual(['https://api.anthropic.com/v1/messages']);
    expect(bodies).toHaveLength(1);
    const [body] = bodies;
    expect(body?.['model']).toBe(ruleSummaryModel);
    expect(body?.['max_tokens']).toBe(8_192);
    expect(body?.['tools']).toBeUndefined();
    expect(body?.['output_config']).toMatchObject({
      effort: 'medium',
      format: { type: 'json_schema' },
    });
    expect(body?.['system']).toEqual([cachedSystemBlock(ruleSummaryInstructions)]);
    expect(JSON.stringify(body?.['messages'])).not.toContain('cache_control');
    expect(JSON.stringify(body?.['messages'])).toContain('<rule_version>\\n{');
  });

  it.each([
    [
      'a server error',
      () => Promise.resolve(new Response(secret, { status: 500 })),
      'summary_unavailable',
    ],
    [
      'a reply that is not JSON',
      () => Promise.resolve(message(`${secret} {`)),
      'summary_unparsable',
    ],
    ['a programming error', () => Promise.reject(new RangeError(secret)), 'summary_failed'],
    [
      'a timeout',
      () => Promise.reject(new DOMException(secret, 'TimeoutError')),
      'summary_timeout',
    ],
  ] as const)('turns %s into a fixed code with nothing of the call', async (_, answer, code) => {
    const { fetch, bodies } = fakeFetch(answer);
    const error = await failure(claudeSummarizer({ apiKey: 'test-key', fetch }).summarize(content));
    expect(error.code).toBe(code);
    expect(error.cause).toBeUndefined();
    expect(String(error.stack)).not.toContain(secret);
    expect(bodies).toHaveLength(1);
  });
});
