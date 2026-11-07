import { z } from 'zod';
import { calendarDateSchema } from '../calendar/calendar-date.js';
import type { CheckIssue } from './check.js';
import { slugSchema } from './expression.js';
import {
  knowledgeTextSchema as text,
  pinSchema,
  sourceSchema,
  versionNumberSchema,
} from './route-version.js';
import { type OfficialHosts, officialUrl } from './validate.js';

/** The longest piece of free text in a guide: a paragraph, never a law's text. */
export const maxGuideTextLength = 600;

/**
 * A guide's free text: plain prose the independent check reads as data. No angle brackets and no
 * URLs, so it can neither open a markup or delimiter of its own nor point anywhere but its laws.
 */
const guideTextSchema = z
  .string()
  .min(1)
  .max(maxGuideTextLength)
  .refine((value) => !/[<>]/.test(value), { message: 'Guide text has no angle brackets' })
  .refine((value) => !/[a-z][a-z0-9+.-]*:\/\//i.test(value), { message: 'Guide text has no URLs' });

/**
 * What a specialist in one country knows (ADR-0014, ADR-0027): the laws that govern its routes,
 * how each is usually amended and the pitfalls of reading them. A guide is never a source and never
 * widens what counts as official; each law's URL sits on a host of an official-domain list it pins.
 */
export const countryGuideSchema = z.strictObject({
  schemaVersion: z.literal(1),
  /** The country, as its ISO 3166-1 alpha-2 code in lowercase, which is also its directory. */
  id: z.string().regex(/^[a-z]{2}$/),
  number: versionNumberSchema,
  title: text,
  laws: z
    .array(
      z.strictObject({
        id: slugSchema,
        title: text,
        url: sourceSchema.shape.url,
        verifiedAt: calendarDateSchema,
        amendment: guideTextSchema,
      }),
    )
    .min(1)
    .max(40),
  pitfalls: z
    .array(
      z.strictObject({
        id: slugSchema,
        text: guideTextSchema,
        /** IDs of the laws the pitfall is about. */
        laws: z.array(slugSchema).min(1).max(10),
      }),
    )
    .max(40),
  countries: pinSchema,
  officialDomains: z.array(pinSchema).min(1).max(10),
});

export type CountryGuide = z.infer<typeof countryGuideSchema>;

/** The country a guide is for, as an uppercase alpha-2 code. */
export function guideCountry(guide: Pick<CountryGuide, 'id'>): string {
  return guide.id.toUpperCase();
}

/**
 * Checks what a guide's schema cannot: its country in the pinned countries, each law's URL on a
 * pinned official host, unique law and pitfall IDs, and every pitfall about laws of the guide.
 */
export function checkCountryGuide(
  guide: CountryGuide,
  official: OfficialHosts,
  countries: ReadonlySet<string>,
): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const issue = (path: string, message: string): void => {
    issues.push({ path, message });
  };
  if (!countries.has(guideCountry(guide))) {
    issue('/id', 'The country is in the pinned countries file');
  }
  const lawIds = guide.laws.map((law) => law.id);
  if (new Set(lawIds).size !== lawIds.length) issue('/laws', 'Law IDs are unique');
  guide.laws.forEach((law, index) => {
    if (!officialUrl(law.url, official)) {
      issue(`/laws/${String(index)}/url`, 'A law is on a host of a pinned official-domain list');
    }
  });
  const pitfallIds = guide.pitfalls.map((pitfall) => pitfall.id);
  if (new Set(pitfallIds).size !== pitfallIds.length) issue('/pitfalls', 'Pitfall IDs are unique');
  const known = new Set(lawIds);
  guide.pitfalls.forEach((pitfall, index) => {
    pitfall.laws.forEach((law, lawIndex) => {
      if (!known.has(law)) {
        issue(
          `/pitfalls/${String(index)}/laws/${String(lawIndex)}`,
          'A pitfall names a law of the guide',
        );
      }
    });
  });
  return issues;
}
