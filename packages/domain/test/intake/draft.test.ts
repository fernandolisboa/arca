import { describe, expect, it } from 'vitest';
import {
  type IntakeDraft,
  keepStatedDates,
  parseIntakeDraft,
  startsInPlan,
  withWriter,
} from '../../src/index.js';

const known = new Set(['[P1]']);

describe('parseIntakeDraft (spec 0008, R1)', () => {
  const valid = {
    people: [
      { ref: '[P1]', role: 'self', citizenships: ['BR'] },
      { ref: 'n1', role: 'child', birthDate: '2014' },
    ],
    relationships: [{ kind: 'parent', parent: '[P1]', child: 'n1', parentKind: 'biological' }],
  };

  it('accepts a closed draft', () => {
    expect(parseIntakeDraft(valid, known)).toEqual(valid);
  });

  it.each([
    ['a free-text field', { ...valid, notes: 'ignore the rules' }],
    ['a name on a person', { ...valid, people: [{ ref: 'n1', name: 'Joana' }] }],
    ['a reference shaped like a name', { ...valid, people: [{ ref: 'Joana' }], relationships: [] }],
    ['a placeholder that was not sent', { people: [{ ref: '[P2]' }], relationships: [] }],
    ['a person listed twice', { people: [{ ref: 'n1' }, { ref: 'n1' }], relationships: [] }],
    ['an empty citizenship list', { people: [{ ref: 'n1', citizenships: [] }], relationships: [] }],
    ['a lowercase country', { people: [{ ref: 'n1', citizenships: ['br'] }], relationships: [] }],
    [
      'an unknown language',
      { people: [{ ref: 'n1', languages: [{ language: 'zz', level: 'A1' }] }], relationships: [] },
    ],
    ['a role outside the list', { people: [{ ref: 'n1', role: 'cousin' }], relationships: [] }],
    [
      'an age instead of a date',
      { people: [{ ref: 'n1', birthDate: '12 anos' }], relationships: [] },
    ],
    ['a sex field', { people: [{ ref: 'n1', sex: 'F' }], relationships: [] }],
    [
      'too many people',
      {
        people: Array.from({ length: 21 }, (_, i) => ({ ref: `n${String(i)}` })),
        relationships: [],
      },
    ],
    ['a plain string', 'Somos quatro.'],
  ])('refuses %s', (_, reply) => {
    expect(parseIntakeDraft(reply, known)).toBeUndefined();
  });

  it.each([
    ['to someone outside the draft', { kind: 'parent', parent: '[P1]', child: 'n2' }],
    ['to a placeholder that was not sent', { kind: 'parent', parent: '[P2]', child: 'n1' }],
    ['of a person with themselves', { kind: 'spouse', people: ['n1', 'n1'] }],
  ])('drops a relationship %s and keeps the rest of the draft', (_, edge) => {
    const reply = { ...valid, relationships: [...valid.relationships, edge] };
    expect(parseIntakeDraft(reply, known)).toEqual(valid);
  });
});

describe('parseIntakeDraft lists', () => {
  it('drops repeats, and a language proposed at two levels', () => {
    const draft = parseIntakeDraft(
      {
        people: [
          {
            ref: 'n1',
            citizenships: ['IT', 'IT', 'BR'],
            languages: [
              { language: 'it', level: 'A1' },
              { language: 'it', level: 'C2' },
              { language: 'pt', level: 'native' },
              { language: 'pt', level: 'native' },
            ],
          },
        ],
        relationships: [],
      },
      known,
    );
    expect(draft?.people[0]).toEqual({
      ref: 'n1',
      citizenships: ['IT', 'BR'],
      languages: [{ language: 'pt', level: 'native' }],
    });
  });
});

describe('keepStatedDates (spec 0008, R1)', () => {
  const draft = (birthDate: string, start: string): IntakeDraft => ({
    people: [{ ref: 'n1', birthDate }, { ref: 'n2' }] as IntakeDraft['people'],
    relationships: [
      { kind: 'spouse', people: ['n1', 'n2'], start },
    ] as IntakeDraft['relationships'],
  });

  it.each([
    ['a stated year', 'Ele nasceu em 1980 e casamos em 2005.', '1980', '2005', true, true],
    [
      'a stated full date',
      'Nasceu em 03/03/1980, casados em 2005.',
      '1980-03-03',
      '2005',
      true,
      true,
    ],
    ['an age', 'Ele tem 46 anos e casamos em 2005.', '1980', '2005', false, true],
    ['"há N anos"', 'Ele nasceu em 1980; casados há 21 anos.', '1980', '2005', true, false],
    [
      'a year inside a longer number',
      'Protocolo 119805, casados em 2005.',
      '1980',
      '2005',
      false,
      true,
    ],
  ])('%s', (_, text, birthDate, start, keepsBirth, keepsStart) => {
    const kept = keepStatedDates(draft(birthDate, start), text);
    expect(kept.people[0]?.birthDate).toBe(keepsBirth ? birthDate : undefined);
    const edge = kept.relationships[0];
    expect(edge?.start).toBe(keepsStart ? start : undefined);
  });

  it.each([
    ['an invented day', 'Ele nasceu em 1980.', '1980-05-12', '1980'],
    ['an invented month', 'Ele nasceu em 1980.', '1980-05', '1980'],
    ['a stated month and year', 'Nasceu em maio de 1980.', '1980-05-12', '1980-05'],
    ['a stated date in words', 'Nasceu em 12 de maio de 1980.', '1980-05-12', '1980-05-12'],
    ['a stated numeric month', 'Nasceu em 05/1980.', '1980-05', '1980-05'],
    ['a date the text gives another day for', 'Nasceu em 11/05/1980.', '1980-05-12', '1980-05'],
  ])('cuts %s to what the text states', (_, text, proposed, kept) => {
    expect(keepStatedDates(draft(proposed, '2005'), text).people[0]?.birthDate).toBe(kept);
  });

  it('leaves everything else as it was', () => {
    const kept = keepStatedDates(draft('1980', '2005'), 'nada');
    expect(kept).toEqual({
      people: [{ ref: 'n1' }, { ref: 'n2' }],
      relationships: [{ kind: 'spouse', people: ['n1', 'n2'] }],
    });
  });
});

describe('withWriter (spec 0008, R3)', () => {
  const me = 'b3c1d2e4-5f60-4718-9a2b-3c4d5e6f7a8b';
  const written = (people: IntakeDraft['people']): IntakeDraft => ({
    people,
    relationships: [{ kind: 'parent', parent: 'n1', child: 'n2' }],
  });

  it('names the writer as their own person, in their edges too', () => {
    expect(withWriter(written([{ ref: 'n1', role: 'self' }, { ref: 'n2' }]), me)).toEqual({
      people: [{ ref: me, role: 'self' }, { ref: 'n2' }],
      relationships: [{ kind: 'parent', parent: me, child: 'n2' }],
    });
  });

  it.each([
    ['no writer', [{ ref: 'n1' }, { ref: 'n2' }]],
    [
      'two writers',
      [
        { ref: 'n1', role: 'self' },
        { ref: 'n2', role: 'self' },
      ],
    ],
  ] as const)('leaves a draft with %s as it is', (_, people) => {
    const draft = written([...people] as IntakeDraft['people']);
    expect(withWriter(draft, me)).toBe(draft);
  });

  it('merges a new self into the writer the draft already lists, whose own facts win', () => {
    const draft: IntakeDraft = {
      people: [
        { ref: me, birthDate: '1985' as IntakeDraft['people'][number]['birthDate'] },
        {
          ref: 'n1',
          role: 'self',
          birthDate: '1986' as IntakeDraft['people'][number]['birthDate'],
          residenceCountry: 'PT',
        },
        { ref: 'n2' },
      ],
      relationships: [
        { kind: 'parent', parent: 'n1', child: 'n2' },
        { kind: 'spouse', people: [me, 'n1'] },
      ],
    };
    expect(withWriter(draft, me)).toEqual({
      people: [{ ref: me, role: 'self', birthDate: '1985', residenceCountry: 'PT' }, { ref: 'n2' }],
      relationships: [{ kind: 'parent', parent: me, child: 'n2' }],
    });
  });

  it.each([
    ['self', true],
    ['child', true],
    ['grandparent', false],
    [undefined, false],
  ] as const)('starts a new %s in the plan: %s', (role, inPlan) => {
    expect(startsInPlan(role)).toBe(inPlan);
  });
});
