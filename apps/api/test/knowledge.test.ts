import { routeCatalog } from '@arca/knowledge';
import { describe, expect, it } from 'vitest';

describe('knowledge catalog', () => {
  it('is bundled with the API and holds no unreviewed route', () => {
    expect(routeCatalog.identities('qm-work')).toEqual([]);
  });
});
