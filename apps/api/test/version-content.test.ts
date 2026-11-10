import { parseCalendarDate } from '@arca/domain';
import { describe, expect, it } from 'vitest';
import { checkContent, summaryContent } from '../src/knowledge/version-content.js';
import { createKnowledgeVersions } from '../src/knowledge/versions.js';

// What the AI features read of a version, from a view of the bundled catalog (ADR-0025, ADR-0027).
const versions = createKnowledgeVersions({
  states: () => Promise.resolve(new Map()),
  today: () => parseCalendarDate('2026-11-06'),
});
const [listed] = await versions.list();
if (listed === undefined) throw new Error('the catalog is empty');
const view = await versions.view(listed.routeId, listed.number);
if (view === undefined) throw new Error('the listed version has no view');

describe('the version content the models read', () => {
  it.each([
    ['rule summary', summaryContent],
    ['independent check', checkContent],
  ])("leaves a source's machine-readable address out of the %s's input", (_, content) => {
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
