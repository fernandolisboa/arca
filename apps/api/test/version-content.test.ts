import { parseCalendarDate } from '@arca/domain';
import { bundledRuleData } from '@arca/knowledge/bundled';
import { describe, expect, it } from 'vitest';
import { summaryContent } from '../src/knowledge/version-content.js';
import { createKnowledgeVersions } from '../src/knowledge/versions.js';

// What the rule summary reads of a version, from a view of the bundled catalog (ADR-0025).
const versions = createKnowledgeVersions({
  states: () => Promise.resolve(new Map()),
  today: () => parseCalendarDate('2026-11-06'),
  rules: () => Promise.resolve(bundledRuleData),
});
const [listed] = await versions.list();
if (listed === undefined) throw new Error('the catalog is empty');
const view = await versions.view(listed.routeId, listed.number);
if (view === undefined) throw new Error('the listed version has no view');

describe('the version content the models read', () => {
  it("leaves a source's machine-readable address out of the rule summary's input", () => {
    const content = summaryContent;
    const naming = {
      ...view,
      sources: view.sources.map((source) => ({
        ...source,
        machineReadableUrl: 'https://api.gov.example/law.json',
      })),
    };
    expect(content(naming)).toBe(content(view));
    expect(content(naming)).not.toContain('machineReadableUrl');
    expect(content(view)).toContain(view.sources[0]?.url);
  });
});
