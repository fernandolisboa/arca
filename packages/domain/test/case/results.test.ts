import { describe, expect, it } from 'vitest';
import { decisiveQuestions, questionForFact, routeResult } from '../../src/case/results.js';
import { factKeys } from '../../src/case/facts.js';
import { questionIds } from '../../src/case/questions.js';
import { identityKey, type RouteCatalog } from '../../src/rules/catalog.js';
import { evaluateRoute } from '../../src/rules/engine.js';
import type { MissingFact } from '../../src/rules/missing.js';
import type { Relationship } from '../../src/case/snapshot.js';
import { context, entry } from '../rules/fixtures.js';
import { snapshot } from './builders.js';

const age = (personId: string): MissingFact => ({
  kind: 'fact',
  reference: 'principal.ageYears',
  personId,
});
const birthDate = (personId: string): MissingFact => ({
  kind: 'fact',
  reference: 'person.birthDate',
  personId,
});
const assets = (personId: string): MissingFact => ({ kind: 'marker', personId, marker: 'assets' });

describe('decisiveQuestions (spec 0007, R6)', () => {
  it('counts a question once per route and principal, the most decisive first', () => {
    expect(
      decisiveQuestions(
        [
          { missingFacts: [age('p1'), birthDate('p1'), assets('p2')] },
          { missingFacts: [assets('p2')] },
          { missingFacts: [age('p1'), assets('p2')] },
        ],
        new Set(['p1']),
      ),
    ).toEqual([
      { personId: 'p2', question: 'allAssets', decides: 3, kept: false },
      { personId: 'p1', question: 'birthDate', decides: 2, kept: true },
    ]);
  });

  it('breaks ties by the order of the guided questions', () => {
    const questions = decisiveQuestions(
      [{ missingFacts: [assets('p1'), age('p1')] }],
      new Set(['p1']),
    );
    expect(questions.map(({ question }) => question)).toEqual(['birthDate', 'allAssets']);
  });

  const spouses: Relationship = { kind: 'spouse', people: ['p1', 'p2'] };

  it('asks about a relationship through a person the viewer keeps, when one end is', () => {
    const edge: MissingFact = { kind: 'relationship', edge: spouses };
    expect(decisiveQuestions([{ missingFacts: [edge] }], new Set(['p2']))).toEqual([
      { personId: 'p2', question: 'relationships', decides: 1, kept: true },
    ]);
    const start: MissingFact = {
      kind: 'fact',
      reference: 'edge.start',
      personId: 'p1',
      edge: spouses,
    };
    expect(decisiveQuestions([{ missingFacts: [start] }], new Set(['p2']))).toEqual([
      { personId: 'p2', question: 'relationships', decides: 1, kept: true },
    ]);
  });

  it("asks a lineage fact about the child of the next person in the line, not the ancestor's", () => {
    const line = ['grandparent', 'parent', 'p1'];
    const read = (reference: string): MissingFact => ({
      kind: 'fact',
      reference,
      personId: 'grandparent',
      line,
    });
    expect(
      decisiveQuestions([{ missingFacts: [read('lineage.ancestor.childBirthDate')] }], new Set()),
    ).toEqual([{ personId: 'parent', question: 'birthDate', decides: 1, kept: false }]);
    expect(
      decisiveQuestions(
        [{ missingFacts: [read('lineage.ancestor.citizenshipsAtChildBirth')] }],
        new Set(),
      ).map(({ personId, question }) => [personId, question]),
    ).toEqual([
      ['parent', 'birthDate'],
      ['grandparent', 'citizenships'],
    ]);
    expect(
      decisiveQuestions(
        [{ missingFacts: [read('lineage.ancestor.citizenshipsAtChildBirth')] }],
        new Set(),
        new Set(['parent']),
      ).map(({ personId, question }) => [personId, question]),
    ).toEqual([['grandparent', 'citizenships']]);
  });

  it('has a guided question for every fact the rules read', () => {
    for (const key of factKeys) expect(questionIds).toContain(questionForFact[key]);
  });
});

describe('routeResult (spec 0007, R6)', () => {
  const v1 = entry();
  const catalog: RouteCatalog = {
    identities: () => [v1.identity],
    activeEntry: (identity) =>
      identityKey(identity) === identityKey(v1.identity) ? v1 : undefined,
  };

  it('says a version waits for activation, and holds nothing of its content', () => {
    const result = evaluateRoute(
      snapshot({ people: [{ id: 'p1', birthDate: '1980-01-01' }] }),
      catalog,
      'qm-sample',
      'p1',
      context({ states: new Map() }),
    );
    expect(routeResult(result, 'p1')).toMatchObject({
      status: 'pending_activation',
      version: { number: 1, hash: v1.identity.hash },
      requirements: [],
      missingFacts: [],
    });
  });

  it('lays out an evaluation with its decisive facts and money in currency units', () => {
    const result = evaluateRoute(
      snapshot({ people: [{ id: 'p1', birthDate: '1980-01-01' }] }),
      catalog,
      'qm-sample',
      'p1',
      context(),
    );
    const shown = routeResult(result, 'p1');
    expect(shown).toMatchObject({
      routeId: 'qm-sample',
      principalId: 'p1',
      status: 'missing_information',
      version: { number: 1 },
      unitOpen: true,
    });
    expect(shown.requirements.map(({ id, result: truth }) => [id, truth])).toContainEqual([
      'adult',
      true,
    ]);
    expect(shown.costs[0]?.min).toEqual({ amount: '100', currency: 'EUR' });
    expect(decisiveQuestions([shown], new Set(['p1'])).length).toBeGreaterThan(0);
  });

  it('asks nothing for a route a requirement rules out, or a closed one', () => {
    const minor = snapshot({ people: [{ id: 'p1', birthDate: '2015-01-01' }] });
    const ruledOut = routeResult(evaluateRoute(minor, catalog, 'qm-sample', 'p1', context()), 'p1');
    expect(ruledOut.status).toBe('not_eligible');
    expect(ruledOut.missingFacts).toEqual([]);

    const closed = entry({ status: 'closed', closureSources: ['law'] });
    const closedCatalog: RouteCatalog = {
      identities: () => [closed.identity],
      activeEntry: () => closed,
    };
    const shown = routeResult(
      evaluateRoute(
        snapshot({ people: [{ id: 'p1', birthDate: '1980-01-01' }] }),
        closedCatalog,
        'qm-sample',
        'p1',
        context(),
      ),
      'p1',
    );
    expect(shown.status).toBe('unavailable');
    expect(shown.missingFacts).toEqual([]);
  });

  it('reports the rates the FX table lacks apart from the questions', () => {
    const shown = routeResult(
      evaluateRoute(
        snapshot({
          people: [{ id: 'p1', birthDate: '1980-01-01' }],
          assets: [
            {
              id: 'a1',
              kind: 'cash',
              owners: [{ person: 'p1', share: '1' }],
              value: { amount: 1, currency: 'BRL' },
              valuedAt: '2026-10-01',
              liquid: true,
              sold: 'none',
            },
          ],
        }),
        catalog,
        'qm-sample',
        'p1',
        context(),
      ),
      'p1',
    );
    expect(shown.missingRates).toEqual([{ from: 'BRL', to: 'EUR' }]);
    expect(shown.missingDates).toEqual([]);
  });
});
