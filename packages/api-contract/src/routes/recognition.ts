import { countryCodeSchema, plainSourceSchema, slugSchema } from '@arca/domain';
import { z } from 'zod';
import type { RouteDefinition } from './index.js';

/*
 * How a regulated profession is recognised in each destination, step by step (ADR-0040): reviewed
 * public data, the same for every account, plus the people of the viewer's case each track
 * concerns. The screen words each track and step from its ID; every step carries its sources.
 */

export const RecognitionSource = plainSourceSchema.pick({
  url: true,
  title: true,
  verifiedAt: true,
});
export type RecognitionSource = z.infer<typeof RecognitionSource>;

export const RecognitionTrack = z.object({
  id: slugSchema,
  destinations: z
    .array(
      z.object({
        country: countryCodeSchema,
        steps: z
          .array(z.object({ id: slugSchema, sources: z.array(RecognitionSource).min(1).max(5) }))
          .max(20),
      }),
    )
    .max(50),
});
export type RecognitionTrack = z.infer<typeof RecognitionTrack>;

export const RecognitionTracks = z.object({
  tracks: z.array(RecognitionTrack).max(50),
  /**
   * The people of the viewer's case each track concerns, from what the viewer sees of their work,
   * job offers, registrations and qualifications; empty outside a case.
   */
  holders: z
    .array(z.object({ trackId: slugSchema, personIds: z.array(z.uuid()).max(100) }))
    .max(50),
});
export type RecognitionTracks = z.infer<typeof RecognitionTracks>;

export const getRecognitionTracks = {
  method: 'get',
  path: '/recognition-tracks',
  operationId: 'getRecognitionTracks',
  summary:
    'How each regulated profession the repository covers is recognised in each destination, with the official sources of every step and the date each was read, and which people of the viewer’s case each track concerns; signed in (401 otherwise)',
  response: { description: 'The recognition tracks', schema: RecognitionTracks },
} as const satisfies RouteDefinition<typeof RecognitionTracks>;

export const recognitionRoutes = { getRecognitionTracks } as const;
