import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { coupleEdgeSchema, incomeSchema, parentEdgeSchema } from '../../src/case/snapshot.js';
import {
  type Question,
  type QuestionState,
  answerOf,
  applyAnswers,
  parseCalendarDate,
  parsePartialDate,
  profileMarkers,
  questionFlow,
  questionSteps,
  relatedBy,
  storedAssetSchema,
  storedFinancesSchema,
  storedProfileFactsSchema,
} from '../../src/index.js';

/** Synthetic IDs only. */
const ana = '0b9c3d6e-1f2a-4b5c-8d7e-9f0a1b2c3d4e';
const bruno = '1c0d4e7f-2a3b-4c5d-9e8f-0a1b2c3d4e5f';
const child = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';
const house = '8b7c6d5e-4f3a-4b2c-8d9e-8f7a6b5c4d3e';
const marriage = '9c8d7e6f-5a4b-4c3d-9e0f-9a8b7c6d5e4f';
const parenthood = 'ad9e8f7a-6b5c-4d4e-8f1a-0b9c8d7e6f5a';

const known = {
  countries: new Set(['BR', 'PT', 'US', 'IT']),
  formerCountries: new Set(['YUCS']),
};

const empty: QuestionState = {
  facts: {},
  dependsOn: null,
  finances: undefined,
  assets: [],
  relationships: [],
};

const withFamily: QuestionState = {
  ...empty,
  relationships: [
    {
      id: marriage,
      relationship: {
        kind: 'spouse',
        from: ana,
        to: bruno,
        details: { start: parsePartialDate('2010-05') },
      },
    },
    { id: parenthood, relationship: { kind: 'parent', from: ana, to: child, details: {} } },
  ],
};

const question = (id: string): Question => {
  const found = questionFlow.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(id);
  return found;
};

/** The keys of an object schema, through optional and array wrappers. */
function keysOf(schema: z.ZodType): string[] {
  let current: unknown = schema;
  for (;;) {
    if (typeof current !== 'object' || current === null) return [];
    if ('unwrap' in current && typeof current.unwrap === 'function') {
      current = (current.unwrap as () => unknown).call(current);
    } else if ('element' in current) {
      current = current.element;
    } else if ('shape' in current && typeof current.shape === 'object' && current.shape !== null) {
      return Object.keys(current.shape);
    } else {
      return [];
    }
  }
}

const fieldsOf = (id: string) => {
  const { input } = question(id);
  return input.kind === 'list' ? input.fields.map(({ key }) => key) : [];
};

describe('the guided questions cover the storage schemas (spec 0007, R4)', () => {
  it('asks for every profile fact, and every list item field', () => {
    for (const key of Object.keys(storedProfileFactsSchema.shape)) {
      if (key === 'recordedInFull') continue;
      const asked = questionFlow.find(({ target }) => target.kind === 'fact' && target.key === key);
      expect(asked, key).toBeDefined();
      if (asked?.input.kind === 'list') {
        const shape =
          storedProfileFactsSchema.shape[key as keyof typeof storedProfileFactsSchema.shape];
        expect(fieldsOf(asked.id).sort(), key).toEqual(keysOf(shape).sort());
      }
    }
  });

  it('asks about every completeness marker', () => {
    const markers = questionFlow.flatMap(({ target }) =>
      target.kind === 'marker' ? [target.marker] : [],
    );
    expect(markers.sort()).toEqual([...profileMarkers].sort());
    expect(questionFlow.some(({ target }) => target.kind === 'assetsMarker')).toBe(true);
  });

  it('asks for the finances, the dependence, the assets and the relationship details', () => {
    expect(Object.keys(storedFinancesSchema.shape).sort()).toEqual([
      'assetsRecordedInFull',
      'incomes',
    ]);
    expect(fieldsOf('incomes').sort()).toEqual(Object.keys(incomeSchema.shape).sort());
    expect(questionFlow.some(({ target }) => target.kind === 'dependence')).toBe(true);
    expect(fieldsOf('assets').sort()).toEqual(
      [...Object.keys(storedAssetSchema.shape), 'share'].sort(),
    );
    const { input } = question('relationships');
    if (input.kind !== 'relationships') throw new Error('relationships');
    expect(input.couple.map(({ key }) => key).sort()).toEqual(
      Object.keys(coupleEdgeSchema.shape)
        .filter((key) => key !== 'kind' && key !== 'people')
        .sort(),
    );
    expect(input.parent.map(({ key }) => key).sort()).toEqual(
      Object.keys(parentEdgeSchema.shape)
        .filter((key) => !['kind', 'parent', 'child'].includes(key))
        .sort(),
    );
  });

  it('keeps every question in a step, each ID once', () => {
    const ids = questionFlow.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { step } of questionFlow) expect(questionSteps).toContain(step);
  });
});

describe('answering the guided questions (spec 0007, R4)', () => {
  const apply = (state: QuestionState, answers: Record<string, unknown>) =>
    applyAnswers(
      state,
      Object.entries(answers).map(([questionId, answer]) => ({
        questionId: questionId as never,
        answer,
      })),
      known,
    );

  it('saves facts, with partial dates, and reads them back', () => {
    const applied = apply(empty, {
      birthDate: '1985-04',
      citizenships: [{ country: 'BR', basis: 'birth', lost: 'none' }, { country: 'YUCS' }],
      residenceCountry: 'BR',
      languages: [{ language: 'pt', level: 'native' }],
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.state.facts).toEqual({
      birthDate: '1985-04',
      citizenships: [{ country: 'BR', basis: 'birth', lost: 'none' }, { country: 'YUCS' }],
      residenceCountry: 'BR',
      languages: [{ language: 'pt', level: 'native' }],
    });
    expect(answerOf(question('birthDate'), applied.state)).toBe('1985-04');
    expect(answerOf(question('studying'), applied.state)).toBeUndefined();
  });

  it('takes "Não sei" as leaving the fact out', () => {
    const answered = apply(empty, { studying: true, educationLevel: 6 });
    if (!answered.ok) throw new Error('refused');
    const unknown = apply(answered.state, { studying: null });
    expect(unknown.ok && unknown.state.facts).toEqual({ educationLevel: 6 });
  });

  it('keeps amounts exact: decimal units in the answer, minor units in storage', () => {
    const applied = apply(empty, {
      incomes: [
        { kind: 'active', monthly: { amount: '9000.5', currency: 'BRL' }, sourceCountry: 'BR' },
      ],
    });
    if (!applied.ok) throw new Error('refused');
    expect(applied.state.finances).toEqual({
      incomes: [
        { kind: 'active', monthly: { amount: 900050, currency: 'BRL' }, sourceCountry: 'BR' },
      ],
      assetsRecordedInFull: false,
    });
    expect(answerOf(question('incomes'), applied.state)).toEqual([
      { kind: 'active', monthly: { amount: '9000.5', currency: 'BRL' }, sourceCountry: 'BR' },
    ]);
  });

  it('sets a completeness marker only on yes', () => {
    const yes = apply(withFamily, { allChildren: true, allSpouses: false, allAssets: true });
    if (!yes.ok) throw new Error('refused');
    expect(yes.state.facts.recordedInFull).toEqual(['children']);
    expect(yes.state.finances?.assetsRecordedInFull).toBe(true);
    const unsure = apply(yes.state, { allChildren: null });
    expect(unsure.ok && unsure.state.facts.recordedInFull).toBeUndefined();
    expect(relatedBy(ana, 'children', withFamily.relationships)).toEqual([child]);
    expect(relatedBy(child, 'parents', withFamily.relationships)).toEqual([ana]);
    expect(relatedBy(bruno, 'spouses', withFamily.relationships)).toEqual([ana]);
    expect(relatedBy(ana, 'partners', withFamily.relationships)).toEqual([]);
  });

  it('lists held assets, new ones without an ID, with their share', () => {
    const state: QuestionState = {
      ...empty,
      assets: [
        {
          id: house,
          asset: {
            kind: 'real_estate',
            value: { amount: 50000000, currency: 'BRL' },
            valuedAt: parseCalendarDate('2026-01-10'),
          },
          share: '0.5',
        },
      ],
    };
    expect(answerOf(question('assets'), state)).toEqual([
      {
        id: house,
        kind: 'real_estate',
        value: { amount: '500000', currency: 'BRL' },
        valuedAt: '2026-01-10',
        share: '0.5',
      },
    ]);
    const applied = apply(state, {
      assets: [
        {
          kind: 'cash',
          value: { amount: '100.25', currency: 'EUR' },
          valuedAt: '2026-11-01',
          liquid: true,
          share: '1',
        },
      ],
    });
    expect(applied.ok && applied.state.assets).toEqual([
      {
        asset: {
          kind: 'cash',
          value: { amount: 10025, currency: 'EUR' },
          valuedAt: '2026-11-01',
          liquid: true,
        },
        share: '1',
      },
    ]);
  });

  it('edits relationship details, never their ends or kinds', () => {
    const answer = answerOf(question('relationships'), withFamily);
    expect(answer).toEqual([
      { id: marriage, kind: 'spouse', from: ana, to: bruno, start: '2010-05' },
      { id: parenthood, kind: 'parent', from: ana, to: child },
    ]);
    const applied = apply(withFamily, {
      relationships: [
        { id: marriage, kind: 'spouse', from: ana, to: bruno, start: '2010-05', end: 'none' },
        {
          id: parenthood,
          kind: 'parent',
          from: ana,
          to: child,
          parentKind: 'biological',
          custody: 'full',
        },
      ],
    });
    expect(
      applied.ok && applied.state.relationships.map(({ relationship }) => relationship.details),
    ).toEqual([
      { start: '2010-05', end: 'none' },
      { parentKind: 'biological', custody: 'full' },
    ]);
    expect(
      apply(withFamily, {
        relationships: [
          { id: marriage, kind: 'partner', from: ana, to: bruno },
          { id: parenthood, kind: 'parent', from: ana, to: child },
        ],
      }).ok,
    ).toBe(false);
  });

  it.each([
    ['a date that is not one', { birthDate: '1985-13' }],
    ['a country outside the pinned list', { residenceCountry: 'XX' }],
    ['a former state where only current countries go', { residenceCountry: 'YUCS' }],
    ['a language outside ISO 639-1', { languages: [{ language: 'xx', level: 'B2' }] }],
    ['a choice outside its set', { educationLevel: 9 }],
    [
      'a field the item does not have',
      { jobOffers: [{ country: 'US', sector: 'A', temporary: true, extra: 1 }] },
    ],
    [
      'an amount finer than the currency',
      {
        incomes: [
          { kind: 'active', monthly: { amount: '1.001', currency: 'BRL' }, sourceCountry: 'BR' },
        ],
      },
    ],
    [
      'an amount in minor units',
      {
        incomes: [
          { kind: 'active', monthly: { amount: 100, currency: 'BRL' }, sourceCountry: 'BR' },
        ],
      },
    ],
    [
      'an asset ID the person does not hold',
      {
        assets: [
          {
            id: house,
            kind: 'cash',
            value: { amount: '1', currency: 'BRL' },
            valuedAt: '2026-11-01',
            share: '1',
          },
        ],
      },
    ],
    [
      'a share of nothing',
      {
        assets: [
          {
            kind: 'cash',
            value: { amount: '1', currency: 'BRL' },
            valuedAt: '2026-11-01',
            share: '0',
          },
        ],
      },
    ],
    ['dependence that is not a list of people', { dependsOn: 'everyone' }],
    ['a marker answered with text', { allChildren: 'yes' }],
    ['an unknown question', { favouriteColour: 'blue' }],
  ])('refuses %s', (_case, answers) => {
    expect(apply(empty, answers).ok).toBe(false);
  });
});
