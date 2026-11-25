import AxeBuilder from '@axe-core/playwright';
import type { CaseView } from '@arca/api-contract/client';
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

/** Synthetic rule data only: an invented route, sources and documents. */
const source = {
  id: 'law',
  url: 'https://www.gov.example/law',
  title: 'Residence act',
  kind: 'official',
  verifiedAt: '2026-10-01',
};
const route = { title: 'Rota de teste para famílias', original: null, country: 'PT' };

/**
 * The results and the checklist answer a fixture route with documents, which no route the
 * database holds has yet; the API's own tests cover how the server computes both.
 */
async function fixtureRoute(page: Page, people: { ana: string; child: string }) {
  const evaluations = {
    rulesAsOf: '2026-11-25',
    engineCommit: 'e2e',
    results: [
      {
        routeId: 'pt-documents-fixture',
        principalId: people.ana,
        status: 'eligible',
        route,
        version: { number: 1, hash: 'a'.repeat(64) },
        stale: false,
        newerProposedVersion: null,
        dependents: [people.child],
        possibleDependents: [],
        unitOpen: false,
        requirements: [],
        assessments: [],
        costs: [],
        durations: [],
        totals: [],
        closureSources: [],
        missingRates: [],
        missingDates: [],
      },
    ],
    questions: [],
  };
  const item = {
    original: null,
    applies: true,
    apostille: null,
    translation: null,
    validity: null,
    note: null,
    noteOriginal: null,
    sources: [source],
    dependsOn: [],
    guides: [],
  };
  const documents = {
    routeId: 'pt-documents-fixture',
    principalId: people.ana,
    status: 'active',
    route,
    version: { number: 1 },
    newerProposedVersion: null,
    documents: {
      kind: 'listed',
      asksNone: false,
      people: [
        {
          personId: people.ana,
          role: 'principal',
          items: [
            {
              ...item,
              documentId: 'passport',
              title: 'Passaporte válido',
              kind: 'passport',
              translation: 'none',
              validity: 'P6M',
            },
          ],
        },
        {
          personId: people.child,
          role: 'dependent',
          items: [
            {
              ...item,
              documentId: 'birth-certificate',
              title: 'Certidão de nascimento',
              kind: 'birth_certificate',
              apostille: true,
              translation: 'sworn',
              guides: [
                {
                  country: 'BR',
                  onlineUrl: null,
                  cost: {
                    min: { amount: '50', currency: 'BRL' },
                    max: { amount: '80', currency: 'BRL' },
                  },
                  leadTime: { min: 'P1D', max: 'P5D', businessDays: true },
                  sources: [
                    {
                      url: 'https://www.gov.example/guide',
                      title: 'Guide',
                      verifiedAt: '2026-10-02',
                    },
                  ],
                },
              ],
            },
            {
              ...item,
              documentId: 'enrollment',
              title: 'Comprovante de matrícula',
              kind: 'school_enrollment',
              applies: 'unknown',
              dependsOn: [{ personId: people.child, question: 'studying', kept: true }],
            },
          ],
        },
      ],
      unit: [
        {
          ...item,
          documentId: 'bank-statement',
          title: 'Extrato bancário',
          kind: 'bank_statement',
        },
      ],
    },
  };
  await page.route('**/v1/case/evaluations', (request) => request.fulfill({ json: evaluations }));
  await page.route('**/v1/case/documents?*', (request) => request.fulfill({ json: documents }));
  return documents;
}

test('opens a route’s document checklist from the results and reads two people’s lists (spec #519)', async ({
  page,
}, testInfo) => {
  const problems = watchProblems(page);
  await signedIn(page);
  await family(page);
  const view = (await (await page.request.get(`${databaseServer.origin}/v1/case`)).json()) as {
    case: CaseView;
  };
  const id = (name: string) =>
    view.case.people.find(({ displayName }) => displayName === name)?.id ?? '';
  const documents = await fixtureRoute(page, { ana: id('Ana'), child: id('Criança') });

  await page.getByRole('link', { name: 'Ver as rotas para a família' }).click();
  const phone = testInfo.project.name === 'phone';
  // A wide screen opens the first route beside the table; a phone opens its card.
  if (phone) await page.getByRole('button', { name: /Rota de teste para famílias/ }).click();
  await page.getByRole('link', { name: 'Ver a lista de documentos' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Lista de documentos' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: route.title })).toBeVisible();

  const list = (name: string) => page.getByRole('region', { name, exact: true });
  if (phone) {
    // Each person is a tab; the selected one's list is the only one shown.
    const tabs = page.getByRole('tablist', { name: 'De quem é a lista' });
    await expect(tabs.getByRole('tab')).toHaveText(['Ana', 'Criança', 'Família toda']);
    await expect(list('Ana')).toContainText('Passaporte válido');
    await tabs.getByRole('tab', { name: 'Criança' }).click();
  } else {
    // The lists sit side by side.
    await expect(list('Ana')).toContainText('Passaporte válido');
    await expect(list('Família toda')).toContainText('Extrato bancário');
  }
  const child = list('Criança');
  await expect(child).toContainText('Dependente · 2 documentos');
  const certificate = child.getByRole('listitem').filter({ hasText: 'Certidão de nascimento' });
  await expect(certificate).toContainText('Apostila: precisa');
  await expect(certificate).toContainText('Tradução: juramentada');
  await expect(certificate).toContainText('Onde tirar (Brasil)');
  await expect(certificate).toContainText('Prazo: de 1 dia a 5 dias, em dias úteis');
  const enrollment = child.getByRole('listitem').filter({ hasText: 'Comprovante de matrícula' });
  await expect(enrollment).toContainText('Pode ser pedido');
  await expect(enrollment).toContainText('Criança está estudando agora?');
  await expect(enrollment).toContainText('O Arca ainda não sabe onde tirar este documento.');

  expect(await horizontalOverflow(page)).toBe(0);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(violations.map(({ id: rule, nodes }) => [rule, nodes.map((node) => node.target)])).toEqual(
    [],
  );

  // A route with no list and a route whose list asks nothing read differently.
  const answer = async (body: unknown) => {
    await page.unroute('**/v1/case/documents?*');
    await page.route('**/v1/case/documents?*', (request) => request.fulfill({ json: body }));
    await page.reload();
  };
  await answer({ ...documents, documents: { kind: 'not_covered' } });
  await expect(
    page.getByText('O Arca ainda não sabe quais documentos esta rota pede.'),
  ).toBeVisible();
  await answer({
    ...documents,
    documents: { kind: 'listed', asksNone: true, people: [], unit: [] },
  });
  await expect(page.getByText('Esta rota não pede nenhum documento.')).toBeVisible();
  await answer({
    ...documents,
    documents: { kind: 'listed', asksNone: false, people: [], unit: [] },
  });
  await expect(
    page.getByText('Nenhum documento desta rota vale para esta família agora.'),
  ).toBeVisible();
  expect(problems).toEqual([]);
});
