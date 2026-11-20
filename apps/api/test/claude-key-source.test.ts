import { describe, expect, it } from 'vitest';
import { ClaudeCallError, claudeClient, type StructuredCall } from '../src/ai/claude.js';

// The Claude client with a key read on every call, as settings serve it (ADR-0031). Synthetic keys.
const call: StructuredCall = {
  model: 'claude-sonnet-5-5',
  instructions: 'Answer.',
  prompt: 'Synthetic.',
  schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
  schemaName: 'answer',
  maxOutputTokens: 100,
  timeoutMs: 5_000,
};

const reply = (stopReason = 'end_turn') =>
  Response.json({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: call.model,
    content: [{ type: 'text', text: '{"ok":true}' }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  });

function recording() {
  const keys: (string | null)[] = [];
  const fetch = ((_: string | URL | Request, init?: RequestInit) => {
    keys.push(new Headers(init?.headers).get('x-api-key'));
    return Promise.resolve(reply());
  }) as typeof globalThis.fetch;
  return { fetch, keys };
}

async function kindOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ClaudeCallError) return { kind: error.kind, message: error.message };
    throw error;
  }
  throw new Error('the call did not fail');
}

describe('a Claude key read on every call (ADR-0031)', () => {
  it('reads the key afresh for each call, so a stored key takes effect at once', async () => {
    const { fetch, keys } = recording();
    const first = `sk-ant-api03-${'first'.repeat(5)}`;
    let current = first;
    const client = claudeClient({ apiKey: () => Promise.resolve(current), fetch });
    await client.object(call);
    current = `sk-ant-api03-${'second'.repeat(5)}`;
    await client.objectStream(call, () => undefined).catch(() => undefined);
    expect(keys[0]).toBe(first);
    expect(keys[1]).toBe(current);
  });

  it('fails as unavailable, sending nothing, when there is no key', async () => {
    const { fetch, keys } = recording();
    const client = claudeClient({ apiKey: () => Promise.resolve(undefined), fetch });
    expect(await kindOf(client.object(call))).toEqual({
      kind: 'unavailable',
      message: 'unavailable',
    });
    expect(await kindOf(client.objectStream(call, () => undefined))).toEqual({
      kind: 'unavailable',
      message: 'unavailable',
    });
    expect(keys).toEqual([]);
  });

  it("fails with a fixed kind, dropping the source's error, when the key cannot be read", async () => {
    const { fetch } = recording();
    const client = claudeClient({
      apiKey: () => Promise.reject(new Error('connection to a database refused: secret detail')),
      fetch,
    });
    expect(await kindOf(client.object(call))).toEqual({ kind: 'failed', message: 'failed' });
  });
});

describe('a reply Claude did not finish', () => {
  it.each(['refusal', 'max_tokens'])(
    'fails as a fixed kind on %s, though its text parses',
    async (stopReason) => {
      const fetch = (() => Promise.resolve(reply(stopReason))) as typeof globalThis.fetch;
      const client = claudeClient({ apiKey: () => Promise.resolve('synthetic'), fetch });
      expect(await kindOf(client.object(call))).toEqual({ kind: 'failed', message: 'failed' });
    },
  );
});
