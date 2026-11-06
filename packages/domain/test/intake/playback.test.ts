import { describe, expect, it } from 'vitest';
import {
  type IntakeDraft,
  type PlaybackVisibility,
  caseSnapshotSchema,
  describeDraft,
  parseCalendarDate,
} from '../../src/index.js';

const at = parseCalendarDate('2026-11-06');
const seen = { profile: true, finances: true };

/** Synthetic: p1 is the viewer, p2 an adult in the case the viewer does not keep. */
const snapshot = caseSnapshotSchema.parse({
  recordedOn: at,
  members: ['p1', 'p2'],
  people: [
    {
      id: 'p1',
      birthDate: '1985',
      citizenships: [{ country: 'BR', basis: 'birth' }],
      languages: [{ language: 'en', level: 'B1' }],
    },
    { id: 'p2' },
  ],
  relationships: [{ kind: 'spouse', people: ['p1', 'p2'] }],
  assets: [],
});
const visibility: PlaybackVisibility = new Map([
  ['p1', seen],
  ['p2', { profile: false, finances: false }],
]);
const kept = new Set(['p1']);

const draft = (input: Partial<IntakeDraft>): IntakeDraft => ({
  people: [],
  relationships: [],
  ...input,
});

describe('describeDraft (spec 0008, R3)', () => {
  it('says only what a new person adds, without the questions still open', () => {
    const { sentences } = describeDraft(
      snapshot,
      draft({
        people: [{ ref: 'p1' }, { ref: 'n1', role: 'child', birthDate: '2014' as never }],
        relationships: [{ kind: 'parent', parent: 'p1', child: 'n1', parentKind: 'biological' }],
      }),
      kept,
      visibility,
      at,
    );
    expect(sentences.map(({ kind }) => kind)).toEqual(['born', 'parent']);
  });

  it('merges a citizenship list by country, keeping what is stored', () => {
    const { snapshot: combined, sentences } = describeDraft(
      snapshot,
      draft({ people: [{ ref: 'p1', citizenships: ['BR', 'IT'] }] }),
      kept,
      visibility,
      at,
    );
    expect(combined.people[0]?.citizenships).toEqual([
      { country: 'BR', basis: 'birth' },
      { country: 'IT' },
    ]);
    expect(sentences).toEqual([
      expect.objectContaining({ kind: 'citizenship', person: 'p1', country: 'IT' }),
    ]);
  });

  it('reads a different language level as a change, not a second entry', () => {
    const { snapshot: combined, sentences } = describeDraft(
      snapshot,
      draft({ people: [{ ref: 'p1', languages: [{ language: 'en', level: 'C1' }] }] }),
      kept,
      visibility,
      at,
    );
    expect(combined.people[0]?.languages).toEqual([{ language: 'en', level: 'C1' }]);
    expect(sentences).toEqual([
      expect.objectContaining({ kind: 'language', language: 'en', level: 'C1' }),
    ]);
  });

  it('drops facts about a person the viewer does not keep', () => {
    const { snapshot: combined, sentences } = describeDraft(
      snapshot,
      draft({ people: [{ ref: 'p2', residenceCountry: 'PT' }] }),
      kept,
      visibility,
      at,
    );
    expect(combined.people[1]).toEqual({ id: 'p2' });
    expect(sentences).toEqual([]);
  });

  it.each([
    [
      'a parent cycle',
      [
        { kind: 'parent', parent: 'p1', child: 'n1' },
        { kind: 'parent', parent: 'n1', child: 'p1' },
      ],
      1,
    ],
    [
      'a fifth parent',
      ['n1', 'n2', 'n3', 'n4', 'n5'].map((parent) => ({ kind: 'parent', parent, child: 'p1' })),
      4,
    ],
    ['a stored edge again', [{ kind: 'spouse', people: ['p1', 'p2'] }], 0],
  ])('drops the edge that would make %s', (_, relationships, added) => {
    const people = ['n1', 'n2', 'n3', 'n4', 'n5'].map((ref) => ({ ref }));
    const { snapshot: combined } = describeDraft(
      snapshot,
      draft({ people, relationships: relationships as IntakeDraft['relationships'] }),
      kept,
      visibility,
      at,
    );
    expect(combined.relationships).toHaveLength(snapshot.relationships.length + added);
    expect(caseSnapshotSchema.safeParse(combined).success).toBe(true);
  });

  it('reads a restated marriage as the stored one, filling only its missing start', () => {
    const { snapshot: combined, sentences } = describeDraft(
      snapshot,
      draft({ relationships: [{ kind: 'spouse', people: ['p2', 'p1'], start: '2010' as never }] }),
      kept,
      visibility,
      at,
    );
    expect(combined.relationships).toEqual([
      { kind: 'spouse', people: ['p1', 'p2'], start: '2010' },
    ]);
    expect(sentences).toEqual([expect.objectContaining({ kind: 'couple', start: '2010' })]);
  });

  it('never changes a stored edge detail', () => {
    const married = caseSnapshotSchema.parse({
      ...snapshot,
      relationships: [{ kind: 'spouse', people: ['p1', 'p2'], start: '2010-06-01' }],
    });
    const { snapshot: combined, sentences } = describeDraft(
      married,
      draft({ relationships: [{ kind: 'spouse', people: ['p1', 'p2'], start: '2010' as never }] }),
      kept,
      visibility,
      at,
    );
    expect(combined.relationships).toEqual(married.relationships);
    expect(sentences).toEqual([]);
  });

  it('keeps a stored birth date that a proposal restates less precisely', () => {
    const { sentences } = describeDraft(
      snapshot,
      draft({ people: [{ ref: 'p1', birthDate: '1985' as never }] }),
      kept,
      visibility,
      at,
    );
    expect(sentences).toEqual([]);
  });

  it('leaves out new people over the case limit but keeps the rest', () => {
    const full = caseSnapshotSchema.parse({
      ...snapshot,
      people: [
        ...snapshot.people,
        ...Array.from({ length: 58 }, (_, i) => ({ id: `p${String(i + 3)}` })),
      ],
    });
    const { snapshot: combined } = describeDraft(
      full,
      draft({ people: [{ ref: 'p1', residenceCountry: 'PT' }, { ref: 'n1' }] }),
      kept,
      visibility,
      at,
    );
    expect(combined.people).toHaveLength(60);
    expect(combined.people[0]?.residenceCountry).toBe('PT');
  });

  it('keeps the stored person when a merged list would break its checks', () => {
    const many = ['AR', 'CL', 'CO', 'DE', 'ES', 'FR', 'IT', 'MX', 'PT', 'US'];
    const { snapshot: combined } = describeDraft(
      snapshot,
      draft({ people: [{ ref: 'p1', citizenships: many }] }),
      kept,
      visibility,
      at,
    );
    expect(combined.people[0]).toEqual(snapshot.people[0]);
  });

  it('writes nothing: the snapshot given is left as it was', () => {
    const before = JSON.stringify(snapshot);
    describeDraft(
      snapshot,
      draft({ people: [{ ref: 'p1', citizenships: ['IT'] }] }),
      kept,
      visibility,
      at,
    );
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
