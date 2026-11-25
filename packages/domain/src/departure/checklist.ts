import { z } from 'zod';
import { countryCodeSchema } from '../case/snapshot.js';
import {
  type Citation,
  type DatedSource,
  checkCitedOfficialSources,
  datedSources,
  officialDomainSchema,
} from '../reviewed-data/official-sources.js';
import { slugSchema } from '../rules/expression.js';
import { plainSourceSchema, versionNumberSchema } from '../rules/route-version.js';

const itemSchema = z.strictObject({
  id: slugSchema,
  sources: z.array(slugSchema).min(1).max(5),
});

const sectionSchema = z.strictObject({
  id: slugSchema,
  items: z.array(itemSchema).min(1).max(30),
});

const checklistSchema = z.strictObject({
  /** The country being left. */
  country: countryCodeSchema,
  sections: z.array(sectionSchema).min(1).max(12),
});

/**
 * What to do before and after leaving a country, and the documents that trace where the family's
 * money came from (ADR-0038). Reviewed data: each item names official sources with the date they
 * were read, and its wording lives in the interface catalog under its ID.
 */
export const departureChecklistsSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    number: versionNumberSchema,
    officialDomains: z.array(officialDomainSchema).min(1).max(20),
    /**
     * The SHA-256 of the catalog wording this file's sources were checked against, so a wording
     * change also changes this file and its reviewers; a test computes it.
     */
    wordingSha256: z.string().regex(/^[0-9a-f]{64}$/),
    sources: z.array(plainSourceSchema).min(1).max(80),
    checklists: z.array(checklistSchema).min(1).max(50),
  })
  .superRefine((file, context) => {
    const issue = (path: (string | number)[], message: string) => {
      context.addIssue({ code: 'custom', path, message });
    };
    const countries = file.checklists.map(({ country }) => country);
    if (new Set(countries).size !== countries.length) {
      issue(['checklists'], 'One checklist per country');
    }
    // Wording is looked up by ID alone, so no two sections or items of the file may share one.
    const sectionIds = new Set<string>();
    const itemIds = new Set<string>();
    const citations: Citation[] = [];
    file.checklists.forEach(({ sections }, at) => {
      sections.forEach(({ id: sectionId, items }, section) => {
        if (sectionIds.has(sectionId)) {
          issue(
            ['checklists', at, 'sections', section, 'id'],
            'Section IDs are unique in the file',
          );
        }
        sectionIds.add(sectionId);
        items.forEach(({ id, sources }, item) => {
          const path = ['checklists', at, 'sections', section, 'items', item];
          if (itemIds.has(id)) issue([...path, 'id'], 'Item IDs are unique in the file');
          itemIds.add(id);
          citations.push({ path, sources });
        });
      });
    });
    checkCitedOfficialSources(file, citations, issue);
  });

export type DepartureChecklists = z.infer<typeof departureChecklistsSchema>;

export type DepartureSource = DatedSource;

export interface DepartureChecklistView {
  readonly country: string;
  readonly sections: readonly {
    readonly id: string;
    readonly items: readonly {
      readonly id: string;
      readonly sources: readonly DepartureSource[];
    }[];
  }[];
}

/** The checklists with each item's sources written out, as the screen shows them. */
export function departureChecklistViews(file: DepartureChecklists): DepartureChecklistView[] {
  const sourcesOf = datedSources(file.sources);
  return file.checklists.map(({ country, sections }) => ({
    country,
    sections: sections.map(({ id, items }) => ({
      id,
      items: items.map((item) => ({ id: item.id, sources: sourcesOf(item.sources) })),
    })),
  }));
}
