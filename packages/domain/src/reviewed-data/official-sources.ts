import { z } from 'zod';
import type { CalendarDate } from '../calendar/calendar-date.js';
import type { plainSourceSchema } from '../rules/route-version.js';
import { hostMatches } from '../rules/validate.js';

/**
 * A host a reviewed data file's sources may sit on, itself or below it, such as `gov.br`. A
 * commercial or generic second-level suffix such as `com.br` would admit any company's site, so
 * it is refused.
 */
export const officialDomainSchema = z
  .string()
  .max(100)
  .regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/)
  .refine((domain) => !/^(?:com|net|org|co)\.[a-z0-9-]+$/.test(domain), {
    message: 'An official domain is not a commercial or generic suffix',
  });

/** An `https` address's host: lowercase, with no port or user name, or undefined. */
const httpsHost = /^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[/?#]|$)/;

/** Whether an address is `https` on one of the domains, or below one. */
export function onOfficialDomain(url: string, domains: readonly string[]): boolean {
  const host = httpsHost.exec(url)?.[1];
  return host !== undefined && hostMatches(host, domains);
}

/** A source as a screen shows it: its address, its title and the day it was read. */
export interface DatedSource {
  readonly url: string;
  readonly title: string;
  readonly verifiedAt: CalendarDate;
}

type Path = (string | number)[];

/** One place in a file that cites sources by ID. */
export interface Citation {
  readonly path: Path;
  readonly sources: readonly string[];
}

/**
 * The checks every reviewed data file of official sources shares (ADR-0038): source IDs are unique,
 * every source is official and on one of the file's domains, a citation names a listed source once,
 * and every source is cited.
 */
export function checkCitedOfficialSources(
  file: {
    readonly sources: readonly z.infer<typeof plainSourceSchema>[];
    readonly officialDomains: readonly string[];
  },
  citations: readonly Citation[],
  issue: (path: Path, message: string) => void,
): void {
  const sourceIds = new Set(file.sources.map(({ id }) => id));
  if (sourceIds.size !== file.sources.length) issue(['sources'], 'Source IDs are unique');
  file.sources.forEach(({ url, kind }, index) => {
    if (kind !== 'official') issue(['sources', index, 'kind'], 'Every source is official');
    if (!onOfficialDomain(url, file.officialDomains)) {
      issue(['sources', index, 'url'], 'The source is on an official domain');
    }
  });
  const cited = new Set<string>();
  for (const { path, sources } of citations) {
    if (new Set(sources).size !== sources.length) {
      issue([...path, 'sources'], 'An item cites a source once');
    }
    sources.forEach((source, index) => {
      cited.add(source);
      if (!sourceIds.has(source)) issue([...path, 'sources', index], 'The source is listed');
    });
  }
  file.sources.forEach(({ id }, index) => {
    if (!cited.has(id)) issue(['sources', index, 'id'], 'Every source is cited');
  });
}

/** Each citation's sources written out, in the order cited. */
export function datedSourceLookup(
  sources: readonly z.infer<typeof plainSourceSchema>[],
): (ids: readonly string[]) => DatedSource[] {
  const byId = new Map(
    sources.map(({ id, url, title, verifiedAt }) => [id, { url, title, verifiedAt }]),
  );
  return (ids) => ids.flatMap((id) => byId.get(id) ?? []);
}
