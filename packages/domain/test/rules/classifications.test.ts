import { describe, expect, it, vi } from 'vitest';
import type { FactDefinition } from '../../src/case/facts.js';
import { routeVersionSchema } from '../../src/rules/route-version.js';
import { type PinnedClassifications } from '../../src/rules/check.js';
import { type OfficialHosts, checkRouteVersion } from '../../src/rules/validate.js';

// No catalog fact reads a classification code yet (the case records that do come with spec 0007's
// next tickets), so these tests add two fixture facts to the catalog the checker reads.
vi.mock('../../src/case/facts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/case/facts.js')>();
  const unknown = (): ReturnType<FactDefinition['derive']> => ({ value: { type: 'token' } });
  const factCatalog = {
    ...actual.factCatalog,
    'person.fixtureOccupation': {
      type: { kind: 'code', classification: 'occupations' },
      scope: 'person',
      derive: unknown,
    },
    'person.fixtureStudyFields': {
      type: { kind: 'codes', classification: 'studyFields' },
      scope: 'person',
      derive: unknown,
    },
  } satisfies Record<string, FactDefinition>;
  return {
    ...actual,
    factCatalog,
    isFactKey: (key: string) => Object.hasOwn(factCatalog, key),
  };
});

const official: OfficialHosts = {
  hosts: ['gov.example'],
  hostOf: (url) => /^https:\/\/([a-z0-9.-]+)\//.exec(url)?.[1],
};

const pinned: PinnedClassifications = {
  occupations: new Set(['2211', '2512']),
  studyFields: new Set(['0912', '0613']),
};

const occupationIn = (...values: string[]): object => ({
  op: 'in',
  item: { op: 'fact', key: 'principal.fixtureOccupation' },
  set: { op: 'tokens', values },
});

const fieldsIntersect = (...values: string[]): object => ({
  op: 'intersects',
  list: { op: 'fact', key: 'principal.fixtureStudyFields' },
  set: { op: 'tokens', values },
});

/** A synthetic route version on an invented country code, with one requirement per expression. */
function issues(
  expressions: readonly object[],
  pins: object = {},
  classifications: PinnedClassifications = pinned,
): string[] {
  const version = routeVersionSchema.parse({
    schemaVersion: 1,
    routeId: 'qm-skilled',
    number: 1,
    title: 'Sample skilled route',
    country: 'QM',
    tags: ['work'],
    effectiveFrom: '2026-01-01',
    status: 'open',
    currency: 'EUR',
    sources: [
      {
        id: 'law',
        url: 'https://www.gov.example/law',
        title: 'Skilled work act',
        kind: 'official',
        verifiedAt: '2026-10-01',
      },
    ],
    countries: { id: 'countries', number: 1 },
    formerCountries: { id: 'former-countries', number: 1 },
    ...pins,
    countrySets: [],
    officialDomains: [{ id: 'qm-gov', number: 1 }],
    requirements: expressions.map((expression, index) => ({
      id: `requirement-${String(index)}`,
      title: 'A requirement',
      expression,
      sources: ['law'],
    })),
    assessments: [],
    dependents: [],
    costs: [],
    durations: [],
  });
  return checkRouteVersion(
    version,
    official,
    { current: new Set(['QM']), former: new Set(), setsWithFormer: new Set() },
    classifications,
  ).map(({ path, message }) => `${path}: ${message}`);
}

const bothPinned = {
  occupations: { id: 'occupations', number: 1 },
  studyFields: { id: 'study-fields', number: 1 },
};

describe('classification codes in a route version', () => {
  it('accepts codes of the pinned classifications', () => {
    expect(issues([occupationIn('2211', '2512'), fieldsIntersect('0912')], bothPinned)).toEqual([]);
  });

  it('refuses a code the pinned version lacks', () => {
    expect(issues([occupationIn('2211', '9999'), fieldsIntersect('0000')], bothPinned)).toEqual([
      '/requirements/0/expression: The values are outside the domain of the fact',
      '/requirements/1/expression: The values are outside the domain of the fact',
    ]);
  });

  it('refuses a code read with no pin, even when the caller has the codes', () => {
    expect(issues([occupationIn('2211'), fieldsIntersect('0912')])).toEqual([
      '/requirements/0/expression/item: Occupation codes need the version to pin occupations',
      '/requirements/1/expression/list: Field-of-study codes need the version to pin studyFields',
    ]);
  });

  it('refuses a pinned classification whose codes did not resolve', () => {
    expect(issues([occupationIn('2211')], bothPinned, {})).toEqual([
      '/requirements/0/expression/item: Occupation codes need the version to pin occupations',
    ]);
  });

  it('keeps an occupation code out of a field-of-study fact', () => {
    expect(
      issues(
        [
          {
            op: 'eq',
            left: { op: 'fact', key: 'principal.fixtureOccupation' },
            right: { op: 'token', value: '0912' },
          },
        ],
        bothPinned,
      ),
    ).toEqual(['/requirements/0/expression: The values are outside the domain of the fact']);
  });

  it('leaves a version that pins nothing and reads no code as it was', () => {
    expect(issues([{ op: 'bool', value: true }], {}, {})).toEqual([]);
  });
});
