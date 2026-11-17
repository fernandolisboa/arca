import {
  type RuleRowReading,
  type RuleRows,
  verifiedOfficialDomainLists,
  verifiedRouteVersion,
} from '@arca/knowledge';
import type { OfficialDomainsView } from './decisions.js';

/** The official-domain lists the stored rows hold, and the lists each route version pins. */
export function officialDomainsView(rows: RuleRows, reading: RuleRowReading): OfficialDomainsView {
  return {
    lists: verifiedOfficialDomainLists(rows, reading),
    pinsOf: (routeId, number) =>
      verifiedRouteVersion(rows, routeId, number, reading)?.version.officialDomains,
  };
}
