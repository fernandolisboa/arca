import {
  type CatalogEntry,
  countrySetSchema,
  identityKey,
  routeVersionSchema,
  versionIdentity,
} from '@arca/domain';
import { z } from 'zod';

/** A SHA-256 digest in lowercase hex. */
export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

const builtEntrySchema = z.strictObject({
  hash: sha256Schema,
  version: routeVersionSchema,
  countrySets: z.array(countrySetSchema),
});

/** Catalog entries from validated, hashed data; parsed again so their types are the domain's. */
export function parseEntries(data: unknown): ReadonlyMap<string, CatalogEntry> {
  const byKey = new Map<string, CatalogEntry>();
  for (const { hash, version, countrySets } of z.array(builtEntrySchema).parse(data)) {
    const identity = versionIdentity(version, hash);
    const key = identityKey(identity);
    if (byKey.has(key)) throw new RangeError('Two catalog entries share an identity');
    byKey.set(key, { identity, version, countrySets });
  }
  return byKey;
}
