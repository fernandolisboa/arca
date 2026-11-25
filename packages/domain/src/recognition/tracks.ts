import { z } from 'zod';
import {
  type CaseSnapshot,
  countryCodeSchema,
  isHeld,
  occupationCodeSchema,
  studyFieldCodeSchema,
} from '../case/snapshot.js';
import {
  type Citation,
  type DatedSource,
  checkCitedOfficialSources,
  datedSourceLookup,
  officialDomainSchema,
} from '../reviewed-data/official-sources.js';
import { slugSchema } from '../rules/expression.js';
import { plainSourceSchema, versionNumberSchema } from '../rules/route-version.js';

const stepSchema = z.strictObject({
  id: slugSchema,
  sources: z.array(slugSchema).min(1).max(5),
});

const destinationSchema = z.strictObject({
  /** The country whose recognition the steps lead to. */
  country: countryCodeSchema,
  steps: z.array(stepSchema).min(1).max(20),
});

const trackSchema = z.strictObject({
  id: slugSchema,
  /** The ISCO-08 unit groups of the profession, as work periods, offers and registrations carry. */
  occupations: z.array(occupationCodeSchema).min(1).max(20),
  /** The ISCED-F fields of study whose qualification leads to the profession. */
  studyFields: z.array(studyFieldCodeSchema).max(20),
  destinations: z.array(destinationSchema).min(1).max(50),
});

/**
 * How a regulated profession's foreign qualification is recognised in each destination, step by
 * step (ADR-0041). Reviewed data: each step names official sources with the date they were read,
 * and its wording lives in the interface catalog under its ID.
 */
export const recognitionTracksSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    number: versionNumberSchema,
    officialDomains: z.array(officialDomainSchema).min(1).max(30),
    /**
     * The SHA-256 of the catalog wording this file's sources were checked against, so a wording
     * change also changes this file and its reviewers; a test computes it.
     */
    wordingSha256: z.string().regex(/^[0-9a-f]{64}$/),
    sources: z.array(plainSourceSchema).min(1).max(80),
    tracks: z.array(trackSchema).min(1).max(50),
  })
  .superRefine((file, context) => {
    const issue = (path: (string | number)[], message: string) => {
      context.addIssue({ code: 'custom', path, message });
    };
    const trackIds = file.tracks.map(({ id }) => id);
    if (new Set(trackIds).size !== trackIds.length) issue(['tracks'], 'Track IDs are unique');
    // Wording is looked up by ID alone, so no two steps of the file may share one.
    const stepIds = new Set<string>();
    const citations: Citation[] = [];
    file.tracks.forEach(({ destinations }, track) => {
      const countries = destinations.map(({ country }) => country);
      if (new Set(countries).size !== countries.length) {
        issue(['tracks', track, 'destinations'], 'One destination per country in a track');
      }
      destinations.forEach(({ steps }, destination) => {
        steps.forEach(({ id, sources }, step) => {
          const path = ['tracks', track, 'destinations', destination, 'steps', step];
          if (stepIds.has(id)) issue([...path, 'id'], 'Step IDs are unique in the file');
          stepIds.add(id);
          citations.push({ path, sources });
        });
      });
    });
    checkCitedOfficialSources(file, citations, issue);
  });

export type RecognitionTracks = z.infer<typeof recognitionTracksSchema>;

export type RecognitionSource = DatedSource;

export interface RecognitionTrackView {
  readonly id: string;
  readonly occupations: readonly string[];
  readonly studyFields: readonly string[];
  readonly destinations: readonly {
    readonly country: string;
    readonly steps: readonly {
      readonly id: string;
      readonly sources: readonly RecognitionSource[];
    }[];
  }[];
}

/** The tracks with each step's sources written out, as the screen shows them. */
export function recognitionTrackViews(file: RecognitionTracks): RecognitionTrackView[] {
  const sourcesOf = datedSourceLookup(file.sources);
  return file.tracks.map(({ id, occupations, studyFields, destinations }) => ({
    id,
    occupations,
    studyFields,
    destinations: destinations.map(({ country, steps }) => ({
      country,
      steps: steps.map((step) => ({ id: step.id, sources: sourcesOf(step.sources) })),
    })),
  }));
}

/** The people a track concerns, in the snapshot's order. */
export interface RecognitionHolders {
  readonly trackId: string;
  readonly personIds: readonly string[];
}

/**
 * Who in the case each track concerns: a person with a work period, a job offer or a professional
 * registration in one of its occupations, or a qualification in one of its fields of study. A fact
 * the snapshot leaves out concerns nobody.
 */
export function recognitionHolders(
  snapshot: Pick<CaseSnapshot, 'people'>,
  tracks: readonly Pick<RecognitionTrackView, 'id' | 'occupations' | 'studyFields'>[],
): RecognitionHolders[] {
  const profiles = snapshot.people.map((person) => ({
    id: person.id,
    occupations: new Set(
      [
        ...(person.workPeriods ?? []),
        ...(person.jobOffers ?? []),
        ...(person.registrations ?? []),
      ].flatMap(({ occupation }) => occupation ?? []),
    ),
    fields: new Set(
      (person.qualifications ?? []).filter(isHeld).flatMap(({ field }) => field ?? []),
    ),
  }));
  return tracks.map(({ id, occupations, studyFields }) => ({
    trackId: id,
    personIds: profiles
      .filter(
        (profile) =>
          occupations.some((code) => profile.occupations.has(code)) ||
          studyFields.some((code) => profile.fields.has(code)),
      )
      .map((profile) => profile.id),
  }));
}

/** The tracks that concern someone first, each group in the file's order. */
export function concernedFirst<Track extends { readonly id: string }>(
  tracks: readonly Track[],
  holders: readonly RecognitionHolders[],
): Track[] {
  const concerned = new Set(
    holders.filter(({ personIds }) => personIds.length > 0).map(({ trackId }) => trackId),
  );
  return [
    ...tracks.filter(({ id }) => concerned.has(id)),
    ...tracks.filter(({ id }) => !concerned.has(id)),
  ];
}
