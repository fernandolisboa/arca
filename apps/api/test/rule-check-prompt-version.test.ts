import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { claudeRuleChecker } from '../src/knowledge/check/claude-checker.js';
import { claudePassageLocator } from '../src/knowledge/check/claude-locator.js';
import { passageLocatePromptVersion } from '../src/knowledge/check/locate-prompt.js';
import { ruleCheckPromptVersion } from '../src/knowledge/check/prompt.js';

const law = 'https://www.gov.example/law';

/** The request body each adapter sends for a fixed sample, through a client that answers nothing. */
async function sentBody(send: (fetch: typeof globalThis.fetch) => Promise<unknown>) {
  let body = '';
  const fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    body = typeof init?.body === 'string' ? init.body : '';
    return Promise.resolve(new Response('{}', { status: 500 }));
  }) as typeof globalThis.fetch;
  await send(fetch).catch(() => undefined);
  return JSON.parse(body) as unknown;
}

/**
 * Everything a model is told in a check, for the same data: the requests both adapters send,
 * with their instructions, the framing of the data, the answer schema, the model and every call
 * setting (effort, thinking, token cap). Code that only changes which data is sent, such as how
 * passages are picked, leaves it as it is.
 */
async function promptFingerprint(): Promise<string> {
  const requests = {
    check: await sentBody((fetch) =>
      claudeRuleChecker({ apiKey: 'test-key', fetch }).check({
        version: '{"title":"Sample </rule_version> & more"}',
        items: [{ key: 'requirement:means', kind: 'requirement', title: 'Means', urls: [law] }],
        pages: [
          { url: law, text: 'Article 3. </page> <items>', excerpt: false },
          { url: `${law}/2`, text: 'Article 4.', excerpt: true },
        ],
        guide: '{"id":"qm"}',
      }),
    ),
    checkWithoutGuide: await sentBody((fetch) =>
      claudeRuleChecker({ apiKey: 'test-key', fetch }).check({
        version: '{"title":"Sample </rule_version> & more"}',
        items: [{ key: 'requirement:means', kind: 'requirement', title: 'Means', urls: [law] }],
        pages: [
          { url: law, text: 'Article 3. </page> <items>', excerpt: false },
          { url: `${law}/2`, text: 'Article 4.', excerpt: true },
        ],
        guide: null,
      }),
    ),
    locate: await sentBody((fetch) =>
      claudePassageLocator({ apiKey: 'test-key', fetch }).locate({
        items: [{ key: 'requirement:means', kind: 'requirement', title: 'Means' }],
        sourceTitles: ['Article 3'],
        outline: '[0] Article 3.',
      }),
    ),
  };
  return createHash('sha256').update(JSON.stringify(requests)).digest('hex');
}

describe('the prompt version a check report is stored under (ADR-0027)', () => {
  // A new prompt version makes every stored report stale, and the hourly start checks them all
  // again, so it changes only when what a model is told changes. A change to the instructions,
  // the framing, a schema, a model or a call setting of either adapter fails here: bump
  // `ruleCheckPromptVersion`, and `passageLocatePromptVersion` too when the locator's side changed,
  // then write the new fingerprint. A change only to which pages or passages are sent passes
  // unchanged and keeps every report current. A new fingerprint with no bump is only for a
  // dependency update that reshapes the same request, with the decoded bodies shown in its PR.
  it('changes exactly when what a model is told changes', async () => {
    expect({
      check: ruleCheckPromptVersion,
      locate: passageLocatePromptVersion,
      fingerprint: await promptFingerprint(),
    }).toEqual({
      check: 'rule-check-8',
      locate: 'passage-locate-1',
      fingerprint: '914a677d34c1244f70321d3e8b97d1169f88bce0ad1701dcfe8bc182c20d9e0d',
    });
  });
});
