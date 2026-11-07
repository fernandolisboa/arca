import { readFile } from 'node:fs/promises';
import { routeCatalog } from '@arca/knowledge';
import { describe, expect, it } from 'vitest';
import { ownerList } from '../src/knowledge/owner-list.js';

describe('knowledge catalog', () => {
  it('bundles the knowledge catalog', () => {
    expect(routeCatalog.identities('qm-work')).toEqual([]);
  });
});

describe('owner list (ADR-0027)', () => {
  it('lists the synthetic seed account wherever the seed is the data', async () => {
    const file = new URL('../../../packages/db/seed/accounts.json', import.meta.url);
    const seed = JSON.parse(await readFile(file, 'utf8')) as {
      accounts: readonly { id: string }[];
    };
    const [owner] = seed.accounts;
    expect(ownerList.preview).toEqual([owner?.id]);
    expect(ownerList.development).toEqual([owner?.id]);
  });

  it('lists one real account in production, never the seed account', () => {
    expect(ownerList.production).toHaveLength(1);
    expect(ownerList.production[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(ownerList.production).not.toContain(ownerList.preview[0]);
  });
});
