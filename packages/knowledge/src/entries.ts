import {
  type CatalogEntry,
  type VersionIdentity,
  countrySetSchema,
  identityKey,
  routeVersionSchema,
} from '@arca/domain';
import { z } from 'zod';
import { catalogData } from './generated/catalog.js';

const builtEntrySchema = z.strictObject({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  version: routeVersionSchema,
  countrySets: z.array(countrySetSchema),
});

/** Catalog entries from validated, hashed data; parsed again so their types are the domain's. */
export function parseEntries(data: unknown): ReadonlyMap<string, CatalogEntry> {
  const byKey = new Map<string, CatalogEntry>();
  for (const { hash, version, countrySets } of z.array(builtEntrySchema).parse(data)) {
    const identity: VersionIdentity = {
      routeId: version.routeId,
      number: version.number,
      effectiveFrom: version.effectiveFrom,
      ...(version.corrects === undefined ? {} : { corrects: version.corrects }),
      status: version.status,
      hash,
    };
    const key = identityKey(identity);
    if (byKey.has(key)) throw new RangeError('Two catalog entries share an identity');
    byKey.set(key, { identity, version, countrySets });
  }
  return byKey;
}

/** Every entry of the built catalog, by `identityKey`. */
export const catalogEntries = parseEntries(catalogData);
