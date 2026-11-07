import {
  type CountryCode,
  type CountryGuide,
  countryGuideSchema,
  guideCountry,
} from '@arca/domain';
import { z } from 'zod';
import { sha256Schema } from './entries.js';

/** A country guide with its content hash, which a check report records (ADR-0027). */
export interface CountryGuideEntry {
  readonly hash: string;
  readonly guide: CountryGuide;
}

/** Looks up a country's current guide by its uppercase alpha-2 code. */
export type CountryGuideLookup = (country: CountryCode) => CountryGuideEntry | undefined;

const builtGuideSchema = z.strictObject({ hash: sha256Schema, guide: countryGuideSchema });

/**
 * Each country's current guide: its highest version in the built catalog. Parsed again so its type
 * is the domain's.
 */
export function createGuideLookup(data: unknown): CountryGuideLookup {
  const latest = new Map<string, CountryGuideEntry>();
  const seen = new Set<string>();
  for (const entry of z.array(builtGuideSchema).parse(data)) {
    const country = guideCountry(entry.guide);
    const key = `${country}/${String(entry.guide.number)}`;
    if (seen.has(key)) throw new RangeError('Two guides share a country and a number');
    seen.add(key);
    const current = latest.get(country);
    if (current === undefined || entry.guide.number > current.guide.number) {
      latest.set(country, entry);
    }
  }
  return (country) => latest.get(country);
}
