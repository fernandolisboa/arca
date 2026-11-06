import { readFile } from 'node:fs/promises';
import { routeCatalog } from '@arca/knowledge';
import { describe, expect, it } from 'vitest';
import { approvers } from '../src/knowledge/approvers.js';

describe('knowledge catalog', () => {
  it('bundles the knowledge catalog', () => {
    expect(routeCatalog.identities('qm-work')).toEqual([]);
  });
});

describe('approver list (spec 0007, R7)', () => {
  it('lists the synthetic seed account wherever the seed is the data', async () => {
    const file = new URL('../../../packages/db/seed/accounts.json', import.meta.url);
    const seed = JSON.parse(await readFile(file, 'utf8')) as {
      accounts: readonly { id: string }[];
    };
    const [owner] = seed.accounts;
    expect(approvers.preview).toEqual([owner?.id]);
    expect(approvers.development).toEqual([owner?.id]);
  });

  it('lists one real account in production, never the seed account', () => {
    expect(approvers.production).toHaveLength(1);
    expect(approvers.production[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(approvers.production).not.toContain(approvers.preview[0]);
  });
});
