import { parseCalendarDate } from '@arca/domain';
import { countryGuide } from '@arca/knowledge';
import { describe, expect, it } from 'vitest';
import { checkContent, guideContent, summaryContent } from '../src/knowledge/version-content.js';
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

  it("sends a guide whole, but for a law's machine-readable address", () => {
    const guide = countryGuide('US')?.guide;
    if (guide === undefined) throw new Error('the catalog has no guide for the United States');
    const naming = {
      ...guide,
      laws: guide.laws.map((law) => ({
        ...law,
        machineReadableUrl: 'https://api.gov.example/law.json',
      })),
    };
    expect(guideContent(naming)).toBe(guideContent(guide));
    expect(guideContent(naming)).not.toContain('machineReadableUrl');
    expect(JSON.parse(guideContent(naming))).toEqual({
      ...guide,
      laws: guide.laws.map((law) => ({ ...law, machineReadableUrl: undefined })),
    });
  });
});
