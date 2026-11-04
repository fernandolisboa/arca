import { describe, expect, it } from 'vitest';
import { behindAnswerOf } from '../src/behind-answer.js';

describe('behindAnswerOf', () => {
  it("hands work to the request's waitUntil", () => {
    const kept: Promise<void>[] = [];
    const request = Object.assign(new Request('https://example.com/'), {
      waitUntil: (work: Promise<void>) => kept.push(work),
    });
    const work = Promise.resolve();
    behindAnswerOf(request)(work);
    expect(kept).toEqual([work]);
  });

  it('lets the work run on where the request has no waitUntil', () => {
    expect(() => {
      behindAnswerOf(new Request('https://example.com/'))(Promise.resolve());
    }).not.toThrow();
  });
});
