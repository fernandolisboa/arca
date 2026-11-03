import { sourceSchema } from '@arca/domain';
import { z } from 'zod';
import { sha256Schema as sha256 } from '../src/entries.ts';

const number = z.number().int().min(1);

/** Current countries, ISO 3166-1 alpha-2 (spec 0002, R7). The generator writes these files. */
export const countriesFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.literal('countries'),
  number,
  /** The vendored CLDR release the codes come from, its file's hash and its license. */
  cldr: z.strictObject({
    release: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
    sha256,
    license: z.literal('Unicode-3.0'),
    licenseSha256: sha256,
  }),
  codes: z
    .array(z.string().regex(/^[A-Z]{2}$/))
    .min(1)
    .max(400),
});

/** Former states, ISO 3166-3, allowed only in citizenship and ancestry facts (spec 0002, R7). */
export const formerCountriesFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.literal('former-countries'),
  number,
  codes: z
    .array(z.string().regex(/^[A-Z]{4}$/))
    .min(1)
    .max(200),
  sources: z.array(sourceSchema).min(1).max(50),
});

/**
 * Committed content hashes, append-only (spec 0002, R6): one per route version and country set,
 * keyed by its path under `data` without the extension, and one per RFC 8785 test vector.
 */
export const hashesFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  vectors: z.array(z.strictObject({ name: z.string().regex(/^[a-z0-9-]+$/), sha256 })),
  files: z.array(z.strictObject({ path: z.string().max(200), sha256 })),
});

export type CountriesFile = z.infer<typeof countriesFileSchema>;
export type FormerCountriesFile = z.infer<typeof formerCountriesFileSchema>;
export type HashesFile = z.infer<typeof hashesFileSchema>;
