import { describe, expect, it } from 'vitest';
import { behindAnswerOf } from '../src/behind-answer.js';

describe('behindAnswerOf', () => {
  it("hands work to the request's waitUntil", () => {
    const kept: Promise<void>[] = [];
    const request = Object.assign(new Request('https://example.com/'), {
      waitUntil: (work: Promise<void>) => kept.push(work),
    });
    const work = Promise.resolve();
    behindAnswerOf(request, () => {
      throw new Error('not missing');
    })(work);
    expect(kept).toEqual([work]);
  });

  it('reports a request without waitUntil and lets the work run on', () => {
    let missing = 0;
    behindAnswerOf(new Request('https://example.com/'), () => {
      missing += 1;
    })(Promise.resolve());
    expect(missing).toBe(1);
  });
});
