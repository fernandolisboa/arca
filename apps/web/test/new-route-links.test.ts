import { maxNewRouteLinks } from '@arca/api-contract/client';
import { describe, expect, it } from 'vitest';
import { parsedLinks } from '../src/knowledge/new-route-links.js';

describe('parsedLinks', () => {
  it.each([
    ['', []],
    ['  \n\n ', []],
    [
      ' https://interior.example/visas \n\nhttps://interior.example/fees',
      ['https://interior.example/visas', 'https://interior.example/fees'],
    ],
    ['http://interior.example/visas', undefined],
    ['interior.example/visas', undefined],
    ['https://interior.example/a\nnot a link', undefined],
  ])('reads %j as %j', (text, expected) => {
    expect(parsedLinks(text)).toEqual(expected);
  });

  it('refuses more links than a request names', () => {
    const lines = Array.from(
      { length: maxNewRouteLinks + 1 },
      (_, index) => `https://interior.example/${String(index)}`,
    );
    expect(parsedLinks(lines.slice(0, -1).join('\n'))).toHaveLength(maxNewRouteLinks);
    expect(parsedLinks(lines.join('\n'))).toBeUndefined();
  });
});
