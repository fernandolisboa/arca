import AxeBuilder from '@axe-core/playwright';
import type { CaseView, ChecklistMarkView } from '@arca/api-contract/client';
import { expect, test, type Page } from '@playwright/test';
import { family, signedIn } from './case-accounts.js';
import { horizontalOverflow } from './layouts.js';
import { createdPrfCredential, withoutAutofill } from './passkeys.js';
import { resetRateLimits, seedAccount } from './postgres/accounts.js';
import { reportViolations, watchProblems } from './problems.js';
import { databaseServer } from './servers.js';
import { addFile, setUp } from './vault-steps.js';

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
 * A route the database holds active, so a mark on it is stored and a linked document filed under
 * its country for real; its results and checklist are a fixture with documents, which no route in
 * the database has yet. The API's own tests cover how the server computes both.
 */
const routeId = 'pt-d7';

/**
 * The results and the checklist answer the fixture. A mark goes to the server, and the checklist
 * read back carries the marks it stored, as the server's own read would.
 */
async function fixtureRoute(page: Page, people: { ana: string; child: string }) {
  const evaluations = {
    rulesAsOf: '2026-11-25',
    engineCommit: 'e2e',
    results: [
      {
        routeId: routeId,
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
    mark: null,
  };
  const marking = { editable: true, marksShown: true, progress: null };
  const documents = {
    routeId: routeId,
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
          ...marking,
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
          ...marking,
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
      unit: {
        ...marking,
        items: [
          {
            ...item,
            documentId: 'bank-statement',
            title: 'Extrato bancário',
            kind: 'bank_statement',
          },
        ],
      },
      progress: null,
      noLongerAsked: [],
    },
  };
  const marks = new Map<string, ChecklistMarkView>();
  /** A list as the server would read it back: each item with its stored mark, and progress. */
  const marked = (holder: string, items: readonly { readonly documentId: string }[]) => {
    const withMarks = items.map((each) => ({
      ...each,
      mark: marks.get(`${holder}:${each.documentId}`) ?? null,
    }));
    const had = withMarks.filter(({ mark }) => mark?.state === 'had').length;
    return { items: withMarks, progress: { had, total: withMarks.length } };
  };
  const read = () => {
    const { people: lists, unit } = documents.documents;
    const people = lists.map((list) => ({ ...list, ...marked(list.personId, list.items) }));
    const family = { ...unit, ...marked(people[0]?.personId ?? '', unit.items) };
    const all = [...people, family];
    return {
      ...documents,
      documents: {
        ...documents.documents,
        people,
        unit: family,
        progress: {
          had: all.reduce((sum, { progress }) => sum + progress.had, 0),
          total: all.reduce((sum, { progress }) => sum + progress.total, 0),
        },
      },
    };
  };
  await page.route('**/v1/case/evaluations', (request) => request.fulfill({ json: evaluations }));
  await page.route('**/v1/case/documents?*', (request) => request.fulfill({ json: read() }));
  await page.route('**/v1/case/documents/marks', async (request) => {
    const response = await request.fetch();
    if (response.ok()) {
      const { personId, documentId, mark } = request.request().postDataJSON() as {
        personId: string;
        documentId: string;
        mark: { state: 'had' | 'missing'; vaultDocumentId: string | null } | null;
      };
      const key = `${personId}:${documentId}`;
      if (mark === null) marks.delete(key);
      else marks.set(key, { ...mark, linked: mark.vaultDocumentId !== null });
    }
    await request.fulfill({ response });
  });
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
  await answer({ ...documents, documents: { kind: 'not_covered', noLongerAsked: [] } });
  await expect(
    page.getByText('O Arca ainda não sabe quais documentos esta rota pede.'),
  ).toBeVisible();
  await answer({
    ...documents,
    documents: {
      kind: 'listed',
      asksNone: true,
      people: [],
      unit: { editable: true, marksShown: true, progress: null, items: [] },
      progress: null,
      noLongerAsked: [],
    },
  });
  await expect(page.getByText('Esta rota não pede nenhum documento.')).toBeVisible();
  await answer({
    ...documents,
    documents: {
      kind: 'listed',
      asksNone: false,
      people: [],
      unit: { editable: true, marksShown: true, progress: null, items: [] },
      progress: null,
      noLongerAsked: [],
    },
  });
  await expect(
    page.getByText('Nenhum documento desta rota vale para esta família agora.'),
  ).toBeVisible();
  expect(problems).toEqual([]);
});

test('marks an item, links a vault document and finds it under the route’s country in the vault (spec #519)', async ({
  page,
}, testInfo) => {
  const problems = watchProblems(page);
  await reportViolations(page);
  await withoutAutofill(page);
  const { credential, userId } = await createdPrfCredential(page);
  const { email } = await seedAccount(credential, userId, { confirmed: true });
  await page.goto(`${databaseServer.origin}/sign-in`);
  await page.getByRole('button', { name: 'Entrar com chave de acesso' }).click();
  await expect(page.getByText(`Você entrou como ${email}.`)).toBeVisible();
  await family(page);
  const view = (await (await page.request.get(`${databaseServer.origin}/v1/case`)).json()) as {
    case: CaseView;
  };
  const id = (name: string) =>
    view.case.people.find(({ displayName }) => displayName === name)?.id ?? '';
  await fixtureRoute(page, { ana: id('Ana'), child: id('Criança') });

  // The vault opens only in this page's memory, so the journey moves within the app from here.
  // Phones reach the sections from the menu.
  const nav = async (name: string) => {
    if ((page.viewportSize()?.width ?? 0) < 768) {
      await page.getByRole('button', { name: 'Abrir menu' }).click();
    }
    await page.getByRole('link', { name, exact: true }).first().click();
  };
  await nav('Cofre');
  await setUp(page);
  const certificate = 'certidao-exemplo.txt';
  await addFile(page, certificate, 'synthetic certificate');

  await nav('Família');
  await page.getByRole('link', { name: 'Ver as rotas para a família' }).click();
  const phone = testInfo.project.name === 'phone';
  if (phone) await page.getByRole('button', { name: /Rota de teste para famílias/ }).click();
  await page.getByRole('link', { name: 'Ver a lista de documentos' }).click();
  if (phone) {
    await page
      .getByRole('tablist', { name: 'De quem é a lista' })
      .getByRole('tab', { name: 'Criança' })
      .click();
  }
  const child = page.getByRole('region', { name: 'Criança', exact: true });
  const item = child.getByRole('listitem').filter({ hasText: 'Certidão de nascimento' });
  const had = item.getByRole('button', { name: 'Já tenho' });
  await had.click();
  await expect(had).toHaveAttribute('aria-pressed', 'true');
  await expect(child.getByRole('progressbar', { name: 'Já tem' })).toHaveAttribute(
    'aria-valuetext',
    '1 de 2',
  );

  await item.getByLabel('Ligar um documento do cofre').selectOption({ label: certificate });
  await expect(item.getByText('Ele passa a aparecer também em Portugal, no cofre.')).toBeVisible();
  await item.getByRole('button', { name: 'Ligar', exact: true }).click();
  await expect(item.getByText(`No cofre: ${certificate}`)).toBeVisible();
  expect(await horizontalOverflow(page)).toBe(0);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(violations.map(({ id: rule, nodes }) => [rule, nodes.map((node) => node.target)])).toEqual(
    [],
  );

  await nav('Cofre');
  const countries = page.getByRole('navigation', { name: 'Países' });
  await countries.getByRole('button', { name: /^Portugal\s*:\s*1\s+documento$/ }).click();
  await expect(
    page
      .getByRole('list', { name: 'Documentos' })
      .getByRole('listitem')
      .filter({ hasText: certificate }),
  ).toBeVisible();
  expect(problems).toEqual([]);
});
