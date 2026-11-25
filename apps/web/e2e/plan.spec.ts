import AxeBuilder from '@axe-core/playwright';
import type { CaseView, FamilyPlan, WriteFamilyPlanRequest } from '@arca/api-contract/client';
import { expect, test, type Page } from '@playwright/test';
import { family, signedIn } from './case-accounts.js';
import { horizontalOverflow } from './layouts.js';
import { resetRateLimits } from './postgres/accounts.js';
import { watchProblems } from './problems.js';
import { databaseServer } from './servers.js';

test.skip(!databaseServer.enabled, 'needs ARCA_E2E_DATABASE and a Postgres (see README)');
test.beforeAll(async () => {
  await resetRateLimits();
});

/** Synthetic rule data only: an invented route and amounts. */
const route = { title: 'Rota de teste para famílias', original: null, country: 'PT' };
const routeId = 'pt-plan-fixture';
const euros = (amount: string) => ({ amount, currency: 'EUR' });

function result(principalId: string, dependents: readonly string[]) {
  return {
    routeId,
    principalId,
    status: 'eligible',
    route,
    version: { number: 1, hash: 'a'.repeat(64) },
    stale: false,
    newerProposedVersion: null,
    dependents,
    possibleDependents: [],
    unitOpen: false,
    requirements: [],
    assessments: [],
    costs: [],
    durations: [],
    totals: [
      {
        currency: 'EUR',
        certain: { min: euros('150'), max: euros('150') },
        possibleExtra: { min: euros('0'), max: euros('0') },
      },
    ],
    closureSources: [],
    missingRates: [],
    missingDates: [],
  };
}

/**
 * The plan's screen against a fixture route no database route is, so the API's answers are
 * stubbed here; the API's own tests cover how the server stores and evaluates a plan.
 */
async function fixturePlan(page: Page, people: { ana: string; child: string }) {
  const evaluations = {
    rulesAsOf: '2026-11-25',
    engineCommit: 'e2e',
    results: [result(people.ana, [people.child])],
    questions: [],
  };
  let plan: FamilyPlan = {
    rulesAsOf: '2026-11-25',
    moves: [],
    unplanned: [people.ana, people.child],
    totals: [],
  };
  const written: WriteFamilyPlanRequest[] = [];
  await page.route('**/v1/case/evaluations', (request) => request.fulfill({ json: evaluations }));
  await page.route('**/v1/case/plan', async (request) => {
    if (request.request().method() === 'PUT') {
      const body = request.request().postDataJSON() as WriteFamilyPlanRequest;
      written.push(body);
      const placed = new Set(
        body.moves.flatMap((move) => [move.principalId, ...move.dependentIds]),
      );
      plan = {
        rulesAsOf: '2026-11-25',
        moves: body.moves.map((move) => ({
          stage: move.stage,
          result: result(
            move.principalId,
            move.dependentIds,
          ) as FamilyPlan['moves'][number]['result'],
          dependents: move.dependentIds.map((personId) => ({
            personId,
            coverage: 'covered' as const,
          })),
        })),
        unplanned: [people.ana, people.child].filter((id) => !placed.has(id)),
        totals:
          body.moves.length === 0
            ? []
            : [
                {
                  currency: 'EUR',
                  certain: { min: euros('150'), max: euros('150') },
                  possibleExtra: { min: euros('0'), max: euros('0') },
                },
              ],
      };
    }
    await request.fulfill({ json: plan });
  });
  return written;
}

test('puts a route in the family plan with who goes along, in a stage (ADR-0040)', async ({
  page,
}) => {
  const problems = watchProblems(page);
  await signedIn(page);
  await family(page);
  const view = (await (await page.request.get(`${databaseServer.origin}/v1/case`)).json()) as {
    case: CaseView;
  };
  const id = (name: string) =>
    view.case.people.find(({ displayName }) => displayName === name)?.id ?? '';
  const written = await fixturePlan(page, { ana: id('Ana'), child: id('Criança') });

  await page.getByRole('link', { name: 'Montar o plano da família' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Plano da família' })).toBeVisible();
  await expect(page.getByText('Ainda sem etapa: Ana e Criança.')).toBeVisible();

  await page.getByRole('button', { name: 'Adicionar mudança' }).click();
  const editor = page.getByRole('form', { name: 'Nova mudança' });
  await editor.getByLabel('Quem pede o visto').selectOption({ label: 'Ana' });
  await editor.getByLabel('Rota').selectOption({ label: `Portugal · ${route.title}` });
  await expect(editor.getByText('A rota leva junto.')).toBeVisible();
  await editor.getByRole('checkbox', { name: 'Criança' }).check();
  await editor.getByRole('button', { name: 'Salvar no plano' }).click();

  const stage = page.getByRole('region', { name: 'Etapa 1' });
  const card = stage.getByRole('listitem').filter({ hasText: route.title });
  await expect(card).toContainText('Ana pede o visto · leva Criança');
  await expect(card).toContainText('Elegível');
  await expect(page.getByText('Todo mundo do caso já tem uma etapa.')).toBeVisible();
  expect(written).toEqual([
    {
      moves: [{ stage: 1, routeId, principalId: id('Ana'), dependentIds: [id('Criança')] }],
    },
  ]);

  await card.getByRole('button', { name: 'Ver detalhes' }).click();
  await expect(page.getByText('Dependentes: Criança')).toBeVisible();
  expect(await horizontalOverflow(page)).toBe(0);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(violations.map(({ id: rule, nodes }) => [rule, nodes.map((node) => node.target)])).toEqual(
    [],
  );

  await card.getByRole('button', { name: 'Tirar do plano' }).click();
  await expect(
    page.getByText('O plano ainda está vazio. Comece por quem vai primeiro.'),
  ).toBeVisible();
  expect(problems).toEqual([]);
});
