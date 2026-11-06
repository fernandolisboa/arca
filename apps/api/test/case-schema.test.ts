import { assetKinds, relationshipKinds, shareScopes } from '@arca/db/case-schema';
import { assetKinds as domainAssetKinds, shareScopes as domainShareScopes } from '@arca/domain';
import { describe, expect, it } from 'vitest';

// The database checks the same closed lists the storage schemas validate (spec 0007, R1); the
// db package cannot import the domain, so the two are compared here.
describe('case schema checks', () => {
  it('match the domain lists', () => {
    expect([...assetKinds]).toEqual([...domainAssetKinds]);
    expect([...shareScopes]).toEqual([...domainShareScopes]);
    expect([...relationshipKinds].sort()).toEqual(['parent', 'partner', 'spouse']);
  });
});
