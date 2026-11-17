import { parseEntries, sha256Schema } from './entries.js';
import { catalogData, caseData, hostData, officialDomainData } from './generated/catalog.js';
import { type RuleData, ruleEngineData, sealRuleData } from './rule-rows.js';
import { ruleCaseSummarySchema } from '@arca/domain';
import { z } from 'zod';

// Tests build and open rules read with these; lint keeps this entry point out of the API's source.
export { ruleContent, sealRuleData } from './rule-rows.js';

const casesSchema = z.array(
  z.strictObject({
    hash: sha256Schema,
    casesHash: sha256Schema,
    cases: z.array(ruleCaseSummarySchema),
  }),
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
export const bundledRuleData: RuleData = sealRuleData({
  entries: parseEntries(catalogData),
  cases: casesSchema.parse(caseData),
  hosts: z.record(z.string(), z.string().nullable()).parse(hostData),
  officialDomains: officialDomainsSchema.parse(officialDomainData),
  refused: [],
});

/** The bundled rules as the engine reads them, and every route they have a version of. */
export const { catalog: routeCatalog, routeIds } = ruleEngineData(bundledRuleData);
