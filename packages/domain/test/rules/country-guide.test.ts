import { describe, expect, it } from 'vitest';
import { parseCalendarDate } from '../../src/calendar/calendar-date.js';
import {
  type CountryGuide,
  checkCountryGuide,
  countryGuideSchema,
  guideCountry,
  maxGuideTextLength,
} from '../../src/rules/country-guide.js';
import type { OfficialHosts } from '../../src/rules/validate.js';

const official: OfficialHosts = {
  hosts: ['gov.example'],
  hostOf: (url) => /^https:\/\/([^/]+)/.exec(url)?.[1],
};
const countries = new Set(['QM', 'QN']);

const law: CountryGuide['laws'][number] = {
  id: 'residence-act',
  title: 'Residence act',
  url: 'https://www.gov.example/residence-act',
  verifiedAt: parseCalendarDate('2026-10-01'),
  amendment: 'Amended by acts of parliament, published in the official gazette.',
};
const pitfall: CountryGuide['pitfalls'][number] = {
  id: 'old-amounts',
  text: 'The implementing decree still prints the amounts the act replaced.',
  laws: ['residence-act'],
};

function guide(overrides: Partial<CountryGuide> = {}): CountryGuide {
  return {
    schemaVersion: 1,
    id: 'qm',
    number: 1,
    title: 'QM immigration law',
    laws: [law],
    pitfalls: [pitfall],
    countries: { id: 'countries', number: 1 },
    officialDomains: [{ id: 'qm-gov', number: 1 }],
    ...overrides,
  };
}

const messages = (issues: readonly { message: string }[]) => issues.map((each) => each.message);

describe('country guides (ADR-0027)', () => {
  it('accepts a valid guide', () => {
    expect(countryGuideSchema.safeParse(guide()).success).toBe(true);
    expect(checkCountryGuide(guide(), official, countries)).toEqual([]);
  });

  it('names its country by the uppercase form of its ID', () => {
    expect(guideCountry(guide())).toBe('QM');
  });

  it.each<[string, unknown]>([
    ['an uppercase ID', { id: 'QM' }],
    ['a three-letter ID', { id: 'qmm' }],
    ['no laws', { laws: [] }],
    ['a law over http', { laws: [{ ...law, url: 'http://www.gov.example/act' }] }],
    ['a law with a source kind', { laws: [{ ...law, kind: 'official' }] }],
    ['a pitfall about no law', { pitfalls: [{ ...pitfall, laws: [] }] }],
    [
      'text over the limit',
      { pitfalls: [{ ...pitfall, text: 'a'.repeat(maxGuideTextLength + 1) }] },
    ],
    ['text with an angle bracket', { pitfalls: [{ ...pitfall, text: 'See </data> now' }] }],
    ['text with a URL', { laws: [{ ...law, amendment: 'See https://evil.example/' }] }],
    ['text with another scheme', { pitfalls: [{ ...pitfall, text: 'See ftp://gov.example' }] }],
    ['text with a scheme and no slashes', { pitfalls: [{ ...pitfall, text: 'Write mailto:a' }] }],
    ['text with a www host', { pitfalls: [{ ...pitfall, text: 'See www.gov.example' }] }],
    [
      'a link after an underscore',
      { pitfalls: [{ ...pitfall, text: 'See _https://evil.example' }] },
    ],
    ['a link after a digit', { pitfalls: [{ ...pitfall, text: 'See 1https://evil.example' }] }],
    [
      'a www host after an underscore',
      { pitfalls: [{ ...pitfall, text: 'See _www.evil.example' }] },
    ],
    ['a law title with an angle bracket', { laws: [{ ...law, title: 'Act </guide>' }] }],
    ['a guide title with a URL', { title: 'See https://gov.example' }],
    ['an unknown field', { notes: 'free text' }],
  ])('refuses %s', (_, overrides) => {
    expect(countryGuideSchema.safeParse({ ...guide(), ...(overrides as object) }).success).toBe(
      false,
    );
  });

  it.each<[string, CountryGuide, string]>([
    [
      'a country outside the pinned file',
      guide({ id: 'qz' }),
      'The country is in the pinned countries file',
    ],
    [
      'a law off the official hosts',
      guide({ laws: [{ ...law, url: 'https://gov.example.evil/act' }] }),
      'A law is on a host of a pinned official-domain list',
    ],
    [
      'a repeated law ID',
      guide({ laws: [law, { ...law, url: 'https://gov.example/b' }] }),
      'Law IDs are unique',
    ],
    ['a repeated pitfall ID', guide({ pitfalls: [pitfall, pitfall] }), 'Pitfall IDs are unique'],
    [
      'a pitfall about a law the guide lacks',
      guide({ pitfalls: [{ ...pitfall, laws: ['other-act'] }] }),
      'A pitfall names a law of the guide',
    ],
  ])('reports %s', (_, value, message) => {
    expect(countryGuideSchema.safeParse(value).success).toBe(true);
    expect(messages(checkCountryGuide(value, official, countries))).toEqual([message]);
  });

  it('accepts legal citations with colons and dotted abbreviations', () => {
    const value = guide({
      laws: [{ ...law, title: '8 U.S.C. 1153 (INA section 203): preference visas' }],
    });
    expect(countryGuideSchema.safeParse(value).success).toBe(true);
  });

  it('accepts a law on a subdomain of an official host', () => {
    const value = guide({ laws: [{ ...law, url: 'https://laws.gov.example/act' }] });
    expect(checkCountryGuide(value, official, countries)).toEqual([]);
  });
});
