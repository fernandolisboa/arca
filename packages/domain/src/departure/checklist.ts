import { z } from 'zod';
import type { CalendarDate } from '../calendar/calendar-date.js';
import { countryCodeSchema } from '../case/snapshot.js';
import { slugSchema } from '../rules/expression.js';
import { hostMatches } from '../rules/validate.js';
import { plainSourceSchema, versionNumberSchema } from '../rules/route-version.js';

/** A host a checklist source may sit on, itself or below it, such as `gov.br`. */
const officialDomainSchema = z
  .string()
  .max(100)
  .regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/);

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

/** An `https` address's host: lowercase, with no port or user name, or undefined. */
const httpsHost = /^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[/?#]|$)/;

function onOfficialDomain(url: string, domains: readonly string[]): boolean {
  const host = httpsHost.exec(url)?.[1];
  return host !== undefined && hostMatches(host, domains);
}

/**
 * What to do before and after leaving a country, and the documents that trace where the family's
 * money came from (ADR-0037). Reviewed data: each item names official sources with the date they
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
    const sourceIds = new Set(file.sources.map(({ id }) => id));
    if (sourceIds.size !== file.sources.length) issue(['sources'], 'Source IDs are unique');
    file.sources.forEach(({ url, kind }, index) => {
      if (kind !== 'official') issue(['sources', index, 'kind'], 'Every source is official');
      if (!onOfficialDomain(url, file.officialDomains)) {
        issue(['sources', index, 'url'], 'The source is on an official domain');
      }
    });
    const countries = file.checklists.map(({ country }) => country);
    if (new Set(countries).size !== countries.length) {
      issue(['checklists'], 'One checklist per country');
    }
    // Wording is looked up by ID alone, so no two sections or items of the file may share one.
    const sectionIds = new Set<string>();
    const itemIds = new Set<string>();
    const cited = new Set<string>();
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
          if (new Set(sources).size !== sources.length) {
            issue([...path, 'sources'], 'An item cites a source once');
          }
          sources.forEach((source, index) => {
            cited.add(source);
            if (!sourceIds.has(source)) issue([...path, 'sources', index], 'The source is listed');
          });
        });
      });
    });
    file.sources.forEach(({ id }, index) => {
      if (!cited.has(id)) issue(['sources', index, 'id'], 'Every source is cited');
    });
  });

export type DepartureChecklists = z.infer<typeof departureChecklistsSchema>;

export interface DepartureSource {
  readonly url: string;
  readonly title: string;
  readonly verifiedAt: CalendarDate;
}

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
  const sources = new Map(
    file.sources.map(({ id, url, title, verifiedAt }) => [id, { url, title, verifiedAt }]),
  );
  return file.checklists.map(({ country, sections }) => ({
    country,
    sections: sections.map(({ id, items }) => ({
      id,
      items: items.map((item) => ({
        id: item.id,
        sources: item.sources.flatMap((source) => sources.get(source) ?? []),
      })),
    })),
  }));
}
