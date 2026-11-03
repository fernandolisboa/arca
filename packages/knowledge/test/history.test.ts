import {
  type CaseSnapshot,
  type DecisionState,
  type RouteEvaluation,
  caseSnapshotSchema,
  evaluateRoute,
  fxTableSchema,
  identityKey,
  parseCalendarDate,
} from '@arca/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildKnowledge, formatIssue } from '../scripts/build.ts';
import { createRouteCatalog } from '../src/catalog.ts';
import {
  baseTree,
  buildDate,
  emptyHashes,
  fixtureEntries,
  fixtures,
  routeVersion,
  writeTree,
} from './data.ts';

const version = (number: number, effectiveFrom: string, corrects?: number, extra: object = {}) =>
  routeVersion({
    number,
    effectiveFrom,
    ...(corrects === undefined ? {} : { corrects }),
    ...extra,
  });

describe('version histories that validation rejects (spec 0002, R8)', () => {
  it.each<[string, Record<number, object>, string]>([
    [
      'a correction of a later version dated before the first version',
      { 1: version(1, '2020-01-01'), 2: version(2, '2022-01-01'), 3: version(3, '2019-01-01', 2) },
      "routes/qm-work/3.json: A correction must start after the start of version 1's period, which it does not fix",
    ],
    [
      'a correction of v2 dated the same as v1',
      { 1: version(1, '2020-01-01'), 2: version(2, '2022-01-01'), 3: version(3, '2020-01-01', 2) },
      "routes/qm-work/3.json: A correction must start after the start of version 1's period, which it does not fix",
    ],
    [
      'a correction of an earlier correction dated after the next rule change',
      {
        1: version(1, '2024-01-01'),
        2: version(2, '2024-06-01'),
        3: version(3, '2024-03-01', 1),
        4: version(4, '2024-07-01', 3),
      },
      'routes/qm-work/4.json: From 2024-07-01, selection would pick version 4 instead of version 2',
    ],
    [
      'two corrections of one version, the newer dated earlier',
      {
        1: version(1, '2020-01-01'),
        2: version(2, '2022-01-01'),
        3: version(3, '2023-01-01', 2),
        4: version(4, '2022-06-01', 2),
      },
      'routes/qm-work/4.json: From 2023-01-01, selection would pick version 3 instead of version 4',
    ],
    [
      'a rule change dated before an existing correction',
      { 1: version(1, '2024-01-01'), 2: version(2, '2024-03-01', 1), 3: version(3, '2024-02-01') },
      'routes/qm-work/3.json: A version that corrects nothing starts after every lower-numbered version',
    ],
    [
      'a requirement using since over a birth date',
      {
        1: version(1, '2020-01-01', undefined, {
          leapDayBirthday: 'feb-28',
          leapDayBirthdaySources: ['law'],
          requirements: [
            {
              id: 'adult',
              title: 'The principal is an adult',
              expression: {
                op: 'since',
                date: { op: 'fact', key: 'principal.birthDate' },
                duration: 'P18Y',
              },
              sources: ['law'],
            },
          ],
        }),
      },
      'routes/qm-work/1.json /requirements/0/expression: An age goes through person.ageYears, never since',
    ],
  ])('refuses %s', async (_, versions, expected) => {
    const tree = baseTree();
    for (const [number, each] of Object.entries(versions)) {
      tree[`routes/qm-work/${number}.json`] = each;
    }
    const { issues } = await buildKnowledge(
      await writeTree(tree, emptyHashes()),
      buildDate,
      fixtures,
    );
    expect(issues.map(formatIssue).filter((issue) => !issue.includes('recorded hash'))).toEqual([
      expected,
    ]);
  });
});

/** Synthetic only: one resident of the fixture country. */
const resident: CaseSnapshot = caseSnapshotSchema.parse({
  recordedOn: '2026-10-01',
  members: ['p1'],
  people: [{ id: 'p1', birthDate: '1990-01-01', residenceCountry: 'QM' }],
  relationships: [],
  assets: [],
});

type Outcome =
  | { evaluated: number; status: string; newer?: { version: number; from: string } }
  | { pending: number }
  | { none: true };

function outcomeOf(result: RouteEvaluation): Outcome {
  switch (result.kind) {
    case 'no_version':
      return { none: true };
    case 'pending':
      return { pending: result.pending.number };
    case 'evaluated':
      return {
        evaluated: result.evaluation.versionNumber,
        status: result.status,
        ...(result.newerProposedVersion === undefined
          ? {}
          : {
              newer: {
                version: result.newerProposedVersion.identity.number,
                from: result.newerProposedVersion.from,
              },
            }),
      };
  }
}

describe('selection over the fixture histories, with fixture states (spec 0002, R5 and R8)', () => {
  let catalog: ReturnType<typeof createRouteCatalog>;

  beforeAll(async () => {
    catalog = createRouteCatalog(await fixtureEntries());
  });

  /** Every version of the route active unless listed. */
  function evaluate(
    routeId: string,
    rulesAsOf: string,
    decided: Record<number, DecisionState> = {},
  ): Outcome {
    const states = new Map(
      catalog
        .identities(routeId)
        .map((identity) => [identityKey(identity), decided[identity.number] ?? 'active']),
    );
    const date = parseCalendarDate(rulesAsOf);
    return outcomeOf(
      evaluateRoute(resident, catalog, routeId, 'p1', {
        rulesAsOf: date,
        today: date,
        fx: fxTableSchema.parse({ rates: [] }),
        states,
        engineCommit: 'history',
      }),
    );
  }

  it.each<[string, string, string, Record<number, DecisionState>, Outcome]>([
    ['no version yet', 'qm-closure-proposed', '2019-06-01', {}, { none: true }],
    [
      'an open version, with its closure left proposed',
      'qm-closure-proposed',
      '2025-06-01',
      { 2: 'proposed' },
      { evaluated: 1, status: 'eligible', newer: { version: 2, from: '2026-01-01' } },
    ],
    [
      'a proposed closure once in effect',
      'qm-closure-proposed',
      '2026-06-01',
      { 2: 'proposed' },
      { pending: 2 },
    ],
    [
      'an active closure',
      'qm-closure-proposed',
      '2026-06-01',
      {},
      { evaluated: 2, status: 'unavailable' },
    ],
    [
      'the replacing version',
      'qm-replaced',
      '2026-09-01',
      {},
      { evaluated: 2, status: 'eligible' },
    ],
    [
      'a correction of an earlier version, dated before it',
      'qm-corrections',
      '2019-07-01',
      {},
      { evaluated: 4, status: 'eligible' },
    ],
    [
      'that correction in place of the version it fixes',
      'qm-corrections',
      '2021-01-01',
      {},
      { evaluated: 4, status: 'eligible' },
    ],
    [
      'a correction dated the same as the version it fixes',
      'qm-corrections',
      '2022-06-01',
      {},
      { evaluated: 3, status: 'eligible' },
    ],
    [
      'a later correction of a version already corrected on its own date',
      'qm-corrections',
      '2023-06-01',
      {},
      { evaluated: 5, status: 'eligible' },
    ],
    [
      'a later correction left proposed',
      'qm-corrections',
      '2022-06-01',
      { 5: 'proposed' },
      { evaluated: 3, status: 'eligible', newer: { version: 5, from: '2023-01-01' } },
    ],
    [
      'a proposed correction dated before the active version it fixes',
      'qm-early-correction',
      '2019-06-01',
      { 2: 'proposed' },
      { pending: 2 },
    ],
    [
      'that proposed correction once the active version starts',
      'qm-early-correction',
      '2021-01-01',
      { 2: 'proposed' },
      { pending: 2 },
    ],
    [
      'that correction, once active',
      'qm-early-correction',
      '2021-01-01',
      {},
      { evaluated: 2, status: 'eligible' },
    ],
    [
      'the end of a chain of corrections',
      'qm-chain',
      '2021-01-01',
      {},
      { evaluated: 3, status: 'eligible' },
    ],
    [
      'the end of a chain before its middle starts, so v1 goes only with the whole chain',
      'qm-chain',
      '2020-06-01',
      {},
      { evaluated: 3, status: 'eligible' },
    ],
    [
      'the end of a chain left proposed',
      'qm-chain',
      '2021-01-01',
      { 3: 'proposed' },
      { pending: 3 },
    ],
    [
      'an active version before a newer proposed one',
      'qm-newer-versions',
      '2024-06-01',
      { 2: 'proposed', 3: 'rejected' },
      { evaluated: 1, status: 'eligible', newer: { version: 2, from: '2025-01-01' } },
    ],
    [
      'a newer proposed version, past a rejected one',
      'qm-newer-versions',
      '2026-06-01',
      { 2: 'proposed', 3: 'rejected' },
      { pending: 2 },
    ],
    [
      'an active version with the next one rejected',
      'qm-newer-versions',
      '2026-06-01',
      { 3: 'rejected' },
      { evaluated: 2, status: 'eligible' },
    ],
    [
      'a correction of a rejected correction, which still removes the original',
      'qm-rejected-correction',
      '2021-01-01',
      { 2: 'rejected' },
      { evaluated: 3, status: 'eligible' },
    ],
    [
      'the original, once both corrections are rejected',
      'qm-rejected-correction',
      '2021-01-01',
      { 2: 'rejected', 3: 'rejected' },
      { evaluated: 1, status: 'eligible' },
    ],
    [
      'the first version, before its corrections',
      'qm-correction-of-correction',
      '2024-02-15',
      {},
      { evaluated: 1, status: 'eligible' },
    ],
    [
      'a correction of the first version',
      'qm-correction-of-correction',
      '2024-03-15',
      {},
      { evaluated: 3, status: 'eligible' },
    ],
    [
      'a correction with its own correction left proposed',
      'qm-correction-of-correction',
      '2024-03-15',
      { 4: 'proposed' },
      { evaluated: 3, status: 'eligible', newer: { version: 4, from: '2024-04-01' } },
    ],
    [
      'a correction of that correction',
      'qm-correction-of-correction',
      '2024-04-15',
      {},
      { evaluated: 4, status: 'eligible' },
    ],
    [
      'the rule change after both corrections',
      'qm-correction-of-correction',
      '2024-07-01',
      {},
      { evaluated: 2, status: 'eligible' },
    ],
    [
      'a correction of a correction, dated before it',
      'qm-correction-before-correction',
      '2024-02-15',
      {},
      { evaluated: 3, status: 'eligible' },
    ],
    [
      'that correction after the date of the one it fixes',
      'qm-correction-before-correction',
      '2024-03-15',
      {},
      { evaluated: 3, status: 'eligible' },
    ],
  ])('selects %s', (_, routeId, rulesAsOf, decided, expected) => {
    expect(evaluate(routeId, rulesAsOf, decided)).toEqual(expected);
  });

  it('evaluates a pending application with the rules of its filing date and current facts', () => {
    // Synthetic: a principal who turns 18 between the filing date and the record date.
    const applicant = caseSnapshotSchema.parse({
      recordedOn: '2026-10-01',
      members: ['p1'],
      people: [{ id: 'p1', birthDate: '2008-06-01' }],
      relationships: [],
      assets: [],
    });
    const states = new Map(
      catalog
        .identities('qm-replaced')
        .map((identity) => [identityKey(identity), 'active' as const]),
    );
    const result = evaluateRoute(applicant, catalog, 'qm-replaced', 'p1', {
      rulesAsOf: parseCalendarDate('2026-03-01'),
      factsAsOf: parseCalendarDate('2026-10-01'),
      today: parseCalendarDate('2026-11-03'),
      fx: fxTableSchema.parse({ rates: [] }),
      states,
      engineCommit: 'history',
    });
    if (result.kind !== 'evaluated') throw new Error(`Expected an evaluation, got ${result.kind}`);
    const { versionNumber, rulesAsOf, factsAsOf } = result.evaluation;
    expect({ versionNumber, status: result.status, rulesAsOf, factsAsOf }).toEqual({
      versionNumber: 1,
      status: 'eligible',
      rulesAsOf: '2026-03-01',
      factsAsOf: '2026-10-01',
    });
  });
});
