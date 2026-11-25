import { countryCodeSchema, plainSourceSchema, slugSchema } from '@arca/domain';
import { z } from 'zod';
import type { RouteDefinition } from './index.js';

/*
 * What to do when leaving a country, and the documents that trace where the money came from
 * (ADR-0037): reviewed public data, the same for every account. The screen words each section and
 * item from its ID; every item carries the official pages it rests on.
 */

export const DepartureSource = plainSourceSchema.pick({ url: true, title: true, verifiedAt: true });
export type DepartureSource = z.infer<typeof DepartureSource>;

export const DepartureChecklist = z.object({
  country: countryCodeSchema,
  sections: z
    .array(
      z.object({
        id: slugSchema,
        items: z
          .array(z.object({ id: slugSchema, sources: z.array(DepartureSource).min(1).max(5) }))
          .max(30),
      }),
    )
    .max(12),
});
export type DepartureChecklist = z.infer<typeof DepartureChecklist>;

export const DepartureChecklists = z.object({
  checklists: z.array(DepartureChecklist).max(50),
});
export type DepartureChecklists = z.infer<typeof DepartureChecklists>;

export const getDepartureChecklists = {
  method: 'get',
  path: '/departure-checklists',
  operationId: 'getDepartureChecklists',
  summary:
    'What to do when leaving each country the repository covers, with the official sources of every item and the date each was read; the same public data for every signed-in account (401 otherwise)',
  response: { description: 'The departure checklists', schema: DepartureChecklists },
} as const satisfies RouteDefinition<typeof DepartureChecklists>;

export const departureRoutes = { getDepartureChecklists } as const;
