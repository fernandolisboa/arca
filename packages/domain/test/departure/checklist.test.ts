import { describe, expect, it } from 'vitest';
import {
  departureChecklistViews,
  departureChecklistsSchema,
} from '../../src/departure/checklist.js';

const source = (id: string, url = `https://www.example.gov.qm/${id}`) => ({
  id,
  url,
  title: `Synthetic ${id}`,
  kind: 'official',
  verifiedAt: '2026-11-25',
});

const file = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  number: 1,
  officialDomains: ['gov.qm'],
  sources: [source('notice'), source('law')],
  checklists: [
    {
      country: 'QM',
      sections: [
        {
          id: 'tax',
          items: [
            { id: 'exit-notice', sources: ['notice'] },
            { id: 'exit-law', sources: ['law', 'notice'] },
          ],
        },
      ],
    },
  ],
  ...overrides,
});

const messages = (input: unknown) => {
  const result = departureChecklistsSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map(({ message }) => message);
};

describe('departureChecklistsSchema', () => {
  it('accepts a file whose sources sit on its official domains', () => {
    expect(messages(file())).toEqual([]);
  });

  it.each([
    ['another host', 'https://www.example.org/notice'],
    ['a look-alike host', 'https://notgov.qm/notice'],
    ['plain http', 'http://www.example.gov.qm/notice'],
    ['a user name before the host', 'https://www.example.org@gov.qm/notice'],
    ['a port', 'https://gov.qm:8443/notice'],
  ])('refuses a source on %s', (_, url) => {
    expect(messages(file({ sources: [source('notice', url), source('law')] }))).toContain(
      'The source is on an official domain',
    );
  });

  it('accepts the official domain itself', () => {
    expect(
      messages(file({ sources: [source('notice', 'https://gov.qm/x'), source('law')] })),
    ).toEqual([]);
  });

  it('refuses a secondary source', () => {
    expect(
      messages(file({ sources: [{ ...source('notice'), kind: 'secondary' }, source('law')] })),
    ).toContain('Every source is official');
  });

  it('refuses an unlisted source, an uncited one and a repeated item', () => {
    const issues = messages(
      file({
        sources: [source('notice'), source('law'), source('unused')],
        checklists: [
          {
            country: 'QM',
            sections: [
              { id: 'tax', items: [{ id: 'exit-notice', sources: ['missing'] }] },
              { id: 'family', items: [{ id: 'exit-notice', sources: ['notice', 'law'] }] },
            ],
          },
        ],
      }),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        'The source is listed',
        'Every source is cited',
        'Item IDs are unique in the file',
      ]),
    );
  });

  it('refuses two checklists for one country', () => {
    const [checklist] = file().checklists;
    expect(messages(file({ checklists: [checklist, checklist] }))).toContain(
      'One checklist per country',
    );
  });
});

describe('departureChecklistViews', () => {
  it('writes out each item’s sources in the order it cites them', () => {
    const [view] = departureChecklistViews(departureChecklistsSchema.parse(file()));
    expect(view?.country).toBe('QM');
    expect(view?.sections[0]?.items[1]?.sources.map(({ title }) => title)).toEqual([
      'Synthetic law',
      'Synthetic notice',
    ]);
    expect(view?.sections[0]?.items[1]?.sources[0]).toEqual({
      url: 'https://www.example.gov.qm/law',
      title: 'Synthetic law',
      verifiedAt: '2026-11-25',
    });
  });
});
