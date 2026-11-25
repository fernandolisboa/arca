import { describe, expect, it } from 'vitest';
import {
  recognitionHolders,
  recognitionTrackViews,
  recognitionTracksSchema,
} from '../../src/recognition/tracks.js';

const source = (id: string, url = `https://www.example.gov.qm/${id}`) => ({
  id,
  url,
  title: `Synthetic ${id}`,
  kind: 'official',
  verifiedAt: '2026-11-25',
});

const track = (overrides: Record<string, unknown> = {}) => ({
  id: 'physician',
  occupations: ['2211', '2212'],
  studyFields: ['0912'],
  destinations: [
    {
      country: 'QM',
      steps: [
        { id: 'degree', sources: ['law'] },
        { id: 'board', sources: ['board', 'law'] },
      ],
    },
  ],
  ...overrides,
});

const file = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  number: 1,
  officialDomains: ['gov.qm'],
  wordingSha256: '0'.repeat(64),
  sources: [source('law'), source('board')],
  tracks: [track()],
  ...overrides,
});

const messages = (input: unknown) => {
  const result = recognitionTracksSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map(({ message }) => message);
};

describe('recognitionTracksSchema (ADR-0040)', () => {
  it('accepts a file whose sources sit on its official domains', () => {
    expect(messages(file())).toEqual([]);
  });

  it('refuses a source off its official domains, and an uncited or unlisted one', () => {
    const issues = messages(
      file({
        sources: [source('law', 'https://www.example.org/law'), source('board'), source('unused')],
        tracks: [
          track({ destinations: [{ country: 'QM', steps: [{ id: 'x', sources: ['missing'] }] }] }),
        ],
      }),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        'The source is on an official domain',
        'Every source is cited',
        'The source is listed',
      ]),
    );
  });

  it('refuses a step ID used twice in the file, even across tracks', () => {
    const issues = messages(
      file({
        tracks: [
          track(),
          track({
            id: 'nurse',
            occupations: ['2221'],
            destinations: [{ country: 'QM', steps: [{ id: 'degree', sources: ['law'] }] }],
          }),
        ],
      }),
    );
    expect(issues).toContain('Step IDs are unique in the file');
  });

  it('refuses two tracks with one ID and two destinations for one country', () => {
    const [destination] = track().destinations;
    expect(messages(file({ tracks: [track(), track()] }))).toContain('Track IDs are unique');
    expect(
      messages(file({ tracks: [track({ destinations: [destination, destination] })] })),
    ).toContain('One destination per country in a track');
  });

  it('refuses a track with no occupation', () => {
    expect(messages(file({ tracks: [track({ occupations: [] })] }))).not.toEqual([]);
  });
});

describe('recognitionTrackViews', () => {
  it('writes out each step’s sources in the order it cites them', () => {
    const [view] = recognitionTrackViews(recognitionTracksSchema.parse(file()));
    expect(view?.destinations[0]?.steps[1]?.sources.map(({ title }) => title)).toEqual([
      'Synthetic board',
      'Synthetic law',
    ]);
    expect(view?.destinations[0]?.steps[0]?.sources[0]).toEqual({
      url: 'https://www.example.gov.qm/law',
      title: 'Synthetic law',
      verifiedAt: '2026-11-25',
    });
  });
});

describe('recognitionHolders', () => {
  const tracks = [track(), track({ id: 'nurse', occupations: ['2221'], studyFields: ['0913'] })];
  const holders = (people: Record<string, unknown>[]) =>
    recognitionHolders({ people } as unknown as Parameters<typeof recognitionHolders>[0], tracks);

  it.each([
    ['a professional registration', { registrations: [{ country: 'QM', occupation: '2211' }] }],
    ['a work period', { workPeriods: [{ occupation: '2212' }] }],
    ['a job offer', { jobOffers: [{ country: 'QN', occupation: '2211' }] }],
    ['a qualification in the field', { qualifications: [{ level: 7, field: '0912' }] }],
  ])('names a person with %s', (_, facts) => {
    expect(holders([{ id: 'p1', ...facts }])).toEqual([
      { trackId: 'physician', personIds: ['p1'] },
      { trackId: 'nurse', personIds: [] },
    ]);
  });

  it('names nobody for other occupations, or for records whose occupation is unknown', () => {
    expect(
      holders([
        { id: 'p1', workPeriods: [{ occupation: '2511' }, {}] },
        { id: 'p2', registrations: [{ country: 'QM' }], qualifications: [{ level: 6 }] },
        { id: 'p3' },
      ]),
    ).toEqual([
      { trackId: 'physician', personIds: [] },
      { trackId: 'nurse', personIds: [] },
    ]);
  });

  it('keeps the case’s order and names a person once per track', () => {
    expect(
      holders([
        { id: 'p2', qualifications: [{ field: '0913' }], registrations: [{ occupation: '2221' }] },
        {
          id: 'p1',
          registrations: [{ occupation: '2211' }],
          workPeriods: [{ occupation: '2211' }],
        },
        { id: 'p3', workPeriods: [{ occupation: '2212' }] },
      ]),
    ).toEqual([
      { trackId: 'physician', personIds: ['p1', 'p3'] },
      { trackId: 'nurse', personIds: ['p2'] },
    ]);
  });
});
