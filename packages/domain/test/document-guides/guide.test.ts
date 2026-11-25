import { describe, expect, it } from 'vitest';
import {
  documentGuideEntries,
  documentGuidesSchema,
  guideEntriesFor,
} from '../../src/document-guides/guide.js';

const source = (id: string, url = `https://www.example.gov.qm/${id}`) => ({
  id,
  url,
  title: `Synthetic ${id}`,
  kind: 'official',
  verifiedAt: '2026-11-25',
});

const birthCertificate = {
  kind: 'birth_certificate',
  onlineUrl: 'https://registry.gov.qm/request',
  cost: { min: 0, max: 9500 },
  leadTime: { min: 'P1D', max: 'P15D' },
  sources: ['registry'],
};

const file = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  number: 1,
  officialDomains: ['gov.qm'],
  wordingSha256: '0'.repeat(64),
  sources: [source('registry'), source('apostille')],
  guides: [
    {
      country: 'QM',
      currency: 'BRL',
      entries: [birthCertificate, { kind: 'criminal_record', sources: ['apostille', 'registry'] }],
    },
  ],
  ...overrides,
});

const withEntries = (entries: unknown[], sources = [source('registry'), source('apostille')]) =>
  file({ sources, guides: [{ country: 'QM', currency: 'BRL', entries }] });

const messages = (input: unknown) => {
  const result = documentGuidesSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map(({ message }) => message);
};

describe('documentGuidesSchema (ADR-0039)', () => {
  it('accepts a guide whose sources and links sit on its official domains', () => {
    expect(messages(file())).toEqual([]);
  });

  it('refuses an entry with no source', () => {
    expect(
      messages(withEntries([birthCertificate, { kind: 'criminal_record', sources: [] }])),
    ).not.toEqual([]);
  });

  it.each([
    ['another host', 'https://www.example.org/registry'],
    ['a look-alike host', 'https://notgov.qm/registry'],
    ['plain http', 'http://www.example.gov.qm/registry'],
    ['a user name before the host', 'https://www.example.org@gov.qm/registry'],
  ])('refuses a source on %s', (_, url) => {
    expect(messages(file({ sources: [source('registry', url), source('apostille')] }))).toContain(
      'The source is on an official domain',
    );
  });

  it('refuses a source no entry cites', () => {
    expect(
      messages(file({ sources: [source('registry'), source('apostille'), source('spare')] })),
    ).toContain('Every source is cited');
  });

  it('refuses an entry citing a source the file does not list', () => {
    expect(messages(withEntries([{ ...birthCertificate, sources: ['unknown'] }]))).toContain(
      'The source is listed',
    );
  });

  it('refuses a secondary source', () => {
    expect(
      messages(
        file({ sources: [{ ...source('registry'), kind: 'secondary' }, source('apostille')] }),
      ),
    ).toContain('Every source is official');
  });

  it('refuses an online link off the official domains', () => {
    expect(
      messages(
        withEntries(
          [{ ...birthCertificate, onlineUrl: 'https://registry.example.com/request' }],
          [source('registry')],
        ),
      ),
    ).toContain('The online link is on an official domain');
  });

  it('refuses two entries for one kind in a guide', () => {
    expect(
      messages(withEntries([birthCertificate, { ...birthCertificate, sources: ['apostille'] }])),
    ).toContain('One entry per kind in a guide');
  });

  it('refuses two guides for one country', () => {
    const guide = { country: 'QM', currency: 'BRL', entries: [birthCertificate] };
    const second = {
      ...guide,
      entries: [{ kind: 'criminal_record', sources: ['apostille'] }],
    };
    expect(messages(file({ guides: [guide, second] }))).toContain('One guide per country');
  });

  it.each([
    ['a cost range upside down', { cost: { min: 100, max: 50 } }],
    ['a negative cost', { cost: { min: -1, max: 50 } }],
    ['a cost in fractions of a minor unit', { cost: { min: 0, max: 50.5 } }],
    ['a lead time upside down', { leadTime: { min: 'P10D', max: 'P2D' } }],
    ['a lead time in two units', { leadTime: { min: 'P10D', max: 'P1M' } }],
  ])('refuses %s', (_, change) => {
    expect(
      messages(withEntries([{ ...birthCertificate, ...change }], [source('registry')])),
    ).not.toEqual([]);
  });

  it('accepts an entry that states no cost, lead time or link', () => {
    expect(
      messages(
        withEntries([{ kind: 'birth_certificate', sources: ['registry'] }], [source('registry')]),
      ),
    ).toEqual([]);
  });
});

describe('guideEntriesFor (ADR-0039)', () => {
  const entries = documentGuideEntries(
    documentGuidesSchema.parse(
      file({
        guides: [
          {
            country: 'BR',
            currency: 'BRL',
            entries: [birthCertificate, { kind: 'criminal_record', sources: ['apostille'] }],
          },
        ],
        officialDomains: ['gov.qm'],
      }),
    ),
  );

  it('returns the issuing country’s entry for a citizen, with its sources written out', () => {
    expect(guideEntriesFor(entries, ['IT', 'BR'], 'birth_certificate')).toEqual([
      {
        country: 'BR',
        kind: 'birth_certificate',
        onlineUrl: 'https://registry.gov.qm/request',
        cost: { min: 0, max: 9500, currency: 'BRL' },
        leadTime: { min: 'P1D', max: 'P15D' },
        sources: [
          {
            url: 'https://www.example.gov.qm/registry',
            title: 'Synthetic registry',
            verifiedAt: '2026-11-25',
          },
        ],
      },
    ]);
  });

  it('returns none for a person without that citizenship', () => {
    expect(guideEntriesFor(entries, ['PT'], 'birth_certificate')).toEqual([]);
    expect(guideEntriesFor(entries, [], 'birth_certificate')).toEqual([]);
  });

  it('returns none for a kind the guide lacks', () => {
    expect(guideEntriesFor(entries, ['BR'], 'marriage_certificate')).toEqual([]);
  });

  it('returns one entry per issuing country the person holds', () => {
    const twoGuides = documentGuideEntries(
      documentGuidesSchema.parse(
        file({
          guides: [
            { country: 'BR', currency: 'BRL', entries: [birthCertificate] },
            {
              country: 'PT',
              currency: 'EUR',
              entries: [{ kind: 'birth_certificate', sources: ['apostille'] }],
            },
          ],
        }),
      ),
    );
    expect(
      guideEntriesFor(twoGuides, ['PT', 'BR'], 'birth_certificate').map(({ country }) => country),
    ).toEqual(['BR', 'PT']);
  });
});
