import { createRouteCatalog } from './catalog.js';
import { parseEntries, sha256Schema } from './entries.js';
import { catalogData, caseData, hostData, officialDomainData } from './generated/catalog.js';
import type { RuleData } from './rule-rows.js';
import { ruleCaseSummarySchema } from '@arca/domain';
import { z } from 'zod';

const casesSchema = z.array(
  z.strictObject({ hash: sha256Schema, cases: z.array(ruleCaseSummarySchema) }),
);

const officialDomainsSchema = z.array(
  z.strictObject({
    id: z.string(),
    number: z.int().min(1),
    hosts: z.array(z.string().min(1).max(253)).min(1),
  }),
);

/**
 * The rules as the repository's data directory holds them, validated and hashed by the build: what
 * the import wrote to the database (ADR-0031). Tests and tools read it; the API reads rules from
 * the database and never imports this entry point.
 */
export const bundledRuleData: RuleData = {
  entries: parseEntries(catalogData),
  cases: casesSchema.parse(caseData),
  hosts: z.record(z.string(), z.string().nullable()).parse(hostData),
  officialDomains: officialDomainsSchema.parse(officialDomainData),
  refused: [],
};

/** The bundled rules as the engine reads them: full entries only for active versions. */
export const routeCatalog = createRouteCatalog(bundledRuleData.entries);

/** Every route the bundled rules have a version of, in a stable order. */
export const routeIds: readonly string[] = [
  ...new Set([...bundledRuleData.entries.values()].map(({ identity }) => identity.routeId)),
].sort();
