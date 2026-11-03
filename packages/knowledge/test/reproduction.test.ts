import { describe, expect, it } from 'vitest';
import { createReproductionLookup } from '../src/reproduction.ts';
import { builtEntries } from './data.ts';

describe('createReproductionLookup', () => {
  it('finds an exact version whatever its state, and nothing for other content', async () => {
    const entries = await builtEntries();
    const lookup = createReproductionLookup(entries);
    const [entry] = entries.values();
    if (entry === undefined) throw new Error('One entry expected');
    expect(lookup('qm-work', 1, entry.identity.hash)).toBe(entry);
    expect(lookup('qm-work', 1, 'a'.repeat(64))).toBeUndefined();
    expect(lookup('qm-work', 2, entry.identity.hash)).toBeUndefined();
  });
});
