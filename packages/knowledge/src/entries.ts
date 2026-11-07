import {
  type CatalogEntry,
  type ComparisonEntry,
  type ComparisonIdentity,
  comparisonIdentityKey,
  comparisonVersionSchema,
  countryIndicatorSchema,
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

const builtComparisonSchema = z.strictObject({
  hash: sha256Schema,
  version: comparisonVersionSchema,
  indicators: z.array(countryIndicatorSchema),
});

/** Comparison entries from validated, hashed data; parsed again so their types are the domain's. */
export function parseComparisons(data: unknown): ReadonlyMap<string, ComparisonEntry> {
  const byKey = new Map<string, ComparisonEntry>();
  for (const { hash, version, indicators } of z.array(builtComparisonSchema).parse(data)) {
    const identity: ComparisonIdentity = { comparisonId: version.id, number: version.number, hash };
    const pinned = version.indicators.map((pin) =>
      indicators.find((each) => each.id === pin.id && each.number === pin.number),
    );
    if (pinned.length !== indicators.length || pinned.some((each) => each === undefined)) {
      throw new RangeError('A comparison entry carries exactly the indicators it pins');
    }
    const key = comparisonIdentityKey(identity);
    if (byKey.has(key)) throw new RangeError('Two comparison entries share an identity');
    byKey.set(key, { identity, version, indicators });
  }
  return byKey;
}
