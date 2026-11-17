import { describe, expect, it } from 'vitest';
import { offlineFetcher, pageFetcherFor } from '../src/knowledge/pages/environment.js';

describe('the fetcher each deployment reads cited pages with', () => {
  it('reads nothing only on a development server that asks for it', () => {
    expect(pageFetcherFor('development', true)).toBe(offlineFetcher);
    expect(pageFetcherFor('development', false)).not.toBe(offlineFetcher);
    expect(pageFetcherFor('preview', true)).not.toBe(offlineFetcher);
    expect(pageFetcherFor('production', true)).not.toBe(offlineFetcher);
  });
});
