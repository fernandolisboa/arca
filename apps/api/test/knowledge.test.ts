import { routeCatalog } from '@arca/knowledge';
import { describe, expect, it } from 'vitest';

describe('knowledge catalog', () => {
  it('bundles the knowledge catalog', () => {
    expect(routeCatalog.identities('qm-work')).toEqual([]);
  });
});
