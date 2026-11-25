import { z } from 'zod';
import { type Duration, durationSchema, orderedDurationRange } from '../calendar/duration.js';
import { countryCodeSchema } from '../case/snapshot.js';
import { type CurrencyCode, currencyCodeSchema } from '../money/currency.js';
import {
  type Citation,
  type DatedSource,
  checkCitedOfficialSources,
  datedSources,
  officialDomainSchema,
  onOfficialDomain,
} from '../reviewed-data/official-sources.js';
import { slugSchema } from '../rules/expression.js';
import {
  plainSourceSchema,
  sourceUrlSchema,
  tagSchema,
  versionNumberSchema,
} from '../rules/route-version.js';

/** Whole minor units (centavos for BRL), never negative. */
const minorUnitsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const entrySchema = z.strictObject({
  /** The document kind route items name, such as `birth_certificate`. */
  kind: tagSchema,
  /** Where to ask for it online, on one of the file's official domains. */
  onlineUrl: sourceUrlSchema.optional(),
  /** What it costs, in the guide's currency; absent when the sources do not say. */
  cost: z.strictObject({ min: minorUnitsSchema, max: minorUnitsSchema }).optional(),
  /** How long it takes to get; absent when the sources do not say. */
  leadTime: z.strictObject({ min: durationSchema, max: durationSchema }).optional(),
  sources: z.array(slugSchema).min(1).max(5),
});

const guideSchema = z.strictObject({
  /** The country that issues the documents. */
  country: countryCodeSchema,
  currency: currencyCodeSchema,
  entries: z.array(entrySchema).min(1).max(200),
});

/**
 * Where and how to get each kind of document in the country that issues it (ADR-0039), as ADR-0038
 * keeps departure checklists: reviewed data whose sources sit on official domains with the date
 * they were read, and whose office, request and apostille texts live in the interface catalog
 * under the issuing country and the kind.
 */
export const documentGuidesSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    number: versionNumberSchema,
    officialDomains: z.array(officialDomainSchema).min(1).max(20),
    /**
     * The SHA-256 of the catalog wording this file's sources were checked against, so a wording
     * change also changes this file and its reviewers; a test computes it.
     */
    wordingSha256: z.string().regex(/^[0-9a-f]{64}$/),
    sources: z.array(plainSourceSchema).min(1).max(200),
    guides: z.array(guideSchema).min(1).max(50),
  })
  .superRefine((file, context) => {
    const issue = (path: (string | number)[], message: string) => {
      context.addIssue({ code: 'custom', path, message });
    };
    const countries = file.guides.map(({ country }) => country);
    if (new Set(countries).size !== countries.length) issue(['guides'], 'One guide per country');
    const citations: Citation[] = [];
    file.guides.forEach(({ entries }, at) => {
      const kinds = new Set<string>();
      entries.forEach(({ kind, onlineUrl, cost, leadTime, sources }, index) => {
        const path = ['guides', at, 'entries', index];
        if (kinds.has(kind)) issue([...path, 'kind'], 'One entry per kind in a guide');
        kinds.add(kind);
        if (onlineUrl !== undefined && !onOfficialDomain(onlineUrl, file.officialDomains)) {
          issue([...path, 'onlineUrl'], 'The online link is on an official domain');
        }
        if (cost !== undefined && cost.min > cost.max) {
          issue([...path, 'cost'], 'The minimum cost is not above the maximum');
        }
        if (leadTime !== undefined && !orderedDurationRange(leadTime.min, leadTime.max)) {
          issue(
            [...path, 'leadTime'],
            'A duration range uses one unit and its minimum is not above its maximum',
          );
        }
        citations.push({ path, sources });
      });
    });
    checkCitedOfficialSources(file, citations, issue);
  });

export type DocumentGuides = z.infer<typeof documentGuidesSchema>;

/** One guide entry as a screen shows it; its texts are in the catalog under country and kind. */
export interface DocumentGuideEntry {
  readonly country: string;
  readonly kind: string;
  readonly onlineUrl?: string;
  readonly cost?: { readonly min: number; readonly max: number; readonly currency: CurrencyCode };
  readonly leadTime?: { readonly min: Duration; readonly max: Duration };
  readonly sources: readonly DatedSource[];
}

/** Every entry of every guide, with its sources written out. */
export function documentGuideEntries(file: DocumentGuides): DocumentGuideEntry[] {
  const sourcesOf = datedSources(file.sources);
  return file.guides.flatMap(({ country, currency, entries }) =>
    entries.map(({ kind, onlineUrl, cost, leadTime, sources }) => ({
      country,
      kind,
      ...(onlineUrl === undefined ? {} : { onlineUrl }),
      ...(cost === undefined ? {} : { cost: { ...cost, currency } }),
      ...(leadTime === undefined ? {} : { leadTime }),
      sources: sourcesOf(sources),
    })),
  );
}

/**
 * Where a person can get a document of `kind`: the entry of each issuing country whose citizenship
 * they hold, and none when no guide covers it. `citizenships` are the country codes the person
 * holds; the caller decides which are held at the date it reads.
 */
export function guideEntriesFor(
  entries: readonly DocumentGuideEntry[],
  citizenships: readonly string[],
  kind: string,
): DocumentGuideEntry[] {
  const held = new Set(citizenships);
  return entries.filter((entry) => entry.kind === kind && held.has(entry.country));
}
