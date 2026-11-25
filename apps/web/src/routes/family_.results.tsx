import { ApiError, type CaseEvaluations, type CaseView } from '@arca/api-contract/client';
import { Button, Disclosure, cardClass } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useLocation } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { caseEvaluationsQuery, caseQuery, sessionQuery } from '../api.js';
import { textLinkClass } from '../forms/text-link.js';
import { TextField } from '../forms/text-field.js';
import { useKnowledgeWords, type KnowledgeWords } from '../knowledge/words.js';
import { Page, stickyColumnClass } from '../page.js';
import { anchorCountry, resultRows, rowMatches } from '../results/group.js';
import { RouteDetail } from '../results/route-detail.js';
import { RouteCards, RouteTable, type Selection } from '../results/route-table.js';
import { useMediaQuery } from '../use-media-query.js';

export const Route = createFileRoute('/family_/results')({ component: Results });

/** The results screen (spec 0007, R6): every route for each member, and what would settle it. */
function Results() {
  const words = useKnowledgeWords();
  const { t } = words;
  const session = useQuery(sessionQuery);
  const confirmed = session.data?.confirmed === true;
  const familyCase = useQuery({ ...caseQuery, enabled: confirmed });
  const evaluations = useQuery({ ...caseEvaluationsQuery, enabled: confirmed });
  const title = t('results.title');
  const back = (
    <Link to="/family" className={textLinkClass}>
      {t('results.back')}
    </Link>
  );
  if (session.isError) {
    return (
      <Page narrow title={title}>
        <p>{t('results.signIn')}</p>
        <Link to="/sign-in" className={textLinkClass}>
          {t('session.signIn')}
        </Link>
      </Page>
    );
  }
  if (!session.isSuccess) return <Page title={title} />;
  if (!confirmed) {
    return (
      <Page narrow title={title}>
        <p>{t('session.unconfirmed')}</p>
      </Page>
    );
  }
  const status = evaluations.error instanceof ApiError ? evaluations.error.status : undefined;
  if (familyCase.data?.case === null || status === 404) {
    return (
      <Page narrow title={title}>
        <p>{t('results.noCase')}</p>
        {back}
      </Page>
    );
  }
  if (familyCase.isError || evaluations.isError) {
    return (
      <Page narrow title={title}>
        <p role="alert">{t(status === 429 ? 'results.tooMany' : 'results.loadFailure')}</p>
        <Button
          onClick={() => {
            void familyCase.refetch();
            void evaluations.refetch();
          }}
        >
          {t('results.retry')}
        </Button>
        {back}
      </Page>
    );
  }
  const view = familyCase.data?.case;
  if (view === undefined || evaluations.data === undefined) {
    return <Page title={title} />;
  }
  return (
    <Page title={title} lead={t('results.lead', { date: words.date(evaluations.data.rulesAsOf) })}>
      <Evaluated
        view={view}
        evaluations={evaluations.data}
        admin={session.data.admin}
        words={words}
      />
      {back}
    </Page>
  );
}

/** Wide enough for a table beside the detail panel. */
const wideQuery = '(min-width: 64rem)';

function Evaluated({
  view,
  evaluations,
  admin,
  words,
}: {
  readonly view: CaseView;
  readonly evaluations: CaseEvaluations;
  readonly admin: boolean;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const wide = useMediaQuery(wideQuery);
  const names = new Map(view.people.map((person) => [person.id, person.displayName]));
  const name = (id: string) => names.get(id) ?? t('results.someone');
  const { rows, unnamed } = resultRows(evaluations.results, words.country, words.language);
  const principals = [...new Set(evaluations.results.map(({ principalId }) => principalId))];
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<Selection>();
  const shown = rows.filter((row) => rowMatches(row, search, words.country));
  const { hash } = useLocation();
  const linked = anchorCountry(hash);
  // A link from another screen, such as the comparison, lands on its country's first route.
  useEffect(() => {
    if (hash !== '') document.getElementById(hash)?.scrollIntoView();
  }, [hash]);
  const linkedRow = shown.find(({ route }) => route.country === linked);
  const opened = (chosen === undefined ? linkedRow : undefined) ?? (wide ? shown[0] : undefined);
  const first = opened?.results[0];
  const selection: Selection | undefined =
    chosen !== undefined && shown.some(({ routeId }) => routeId === chosen.routeId)
      ? chosen
      : first === undefined
        ? undefined
        : { routeId: first.routeId, principalId: first.principalId };
  const selectedRow = shown.find(({ routeId }) => routeId === selection?.routeId);
  const detail = selectedRow !== undefined && selection !== undefined && (
    <RouteDetail
      key={selectedRow.routeId}
      row={selectedRow}
      principalId={selection.principalId}
      onPrincipal={(principalId) => {
        setChosen({ routeId: selectedRow.routeId, principalId });
      }}
      inline={!wide}
      name={name}
      words={words}
    />
  );
  const list =
    rows.length === 0 ? (
      unnamed.length === 0 && <p className="text-muted">{t('results.empty')}</p>
    ) : shown.length === 0 ? (
      <p className="text-muted">{t('results.noMatch')}</p>
    ) : wide ? (
      <RouteTable
        rows={shown}
        principals={principals}
        selection={selection}
        onSelect={setChosen}
        name={name}
        words={words}
      />
    ) : (
      <RouteCards
        rows={shown}
        selection={selection}
        onSelect={setChosen}
        name={name}
        words={words}
        detail={detail}
      />
    );
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,32rem)] lg:gap-8">
      <div className="flex min-w-0 flex-col gap-4">
        <h3 className="sr-only">{t('results.routesTitle')}</h3>
        <div className="w-full sm:w-80">
          <TextField
            type="search"
            label={t('results.searchLabel')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            autoComplete="off"
          />
        </div>
        <Questions evaluations={evaluations} name={name} words={words} />
        {list}
        {unnamed.length > 0 && (
          <p className="text-small text-muted">
            {t('results.unnamed', {
              routes: words.list(
                unnamed.map(({ country, count }) =>
                  t('results.unnamedCountry', { n: count, country: words.country(country) }),
                ),
              ),
            })}{' '}
            {admin && (
              <Link to="/knowledge" className={textLinkClass}>
                {t('results.unnamedAdmin')}
              </Link>
            )}
          </p>
        )}
      </div>
      {wide && shown.length > 0 && (
        <aside
          aria-label={t('results.detailTitle')}
          className={`${cardClass} flex min-w-0 flex-col gap-4 p-4 ${stickyColumnClass}`}
        >
          {detail === false ? <p className="text-muted">{t('results.pickRoute')}</p> : detail}
        </aside>
      )}
    </div>
  );
}

/** The questions that change a result, folded above the table so the table stays in view. */
function Questions({
  evaluations,
  name,
  words,
}: {
  readonly evaluations: CaseEvaluations;
  readonly name: (id: string) => string;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const { questions } = evaluations;
  return (
    <Disclosure
      title={t('results.questionsTitle')}
      level={4}
      defaultOpen={false}
      badge={<span className="text-small text-muted tabular-nums">{questions.length}</span>}
      className={`${cardClass} flex flex-col gap-2 px-4 py-1`}
    >
      {questions.length === 0 && (
        <p className="pb-3 text-small text-muted">{t('results.noQuestions')}</p>
      )}
      {questions.length > 0 && (
        <p className="text-small text-muted">{t('results.questionsLead')}</p>
      )}
      <ul className="grid gap-3 pb-3 empty:hidden md:grid-cols-2">
        {questions.map((question) => {
          const asked = t(`questions.asked.${question.question}`, {
            name: name(question.personId),
          });
          return (
            <li
              key={`${question.personId}:${question.question}`}
              className="flex flex-col gap-1 rounded-card border border-line p-3"
            >
              <p>
                {question.kept
                  ? asked
                  : t('results.askKeeper', { name: name(question.personId), question: asked })}
              </p>
              <p className="text-small text-muted">
                {t('results.decides', { n: question.decides })}
              </p>
              {question.kept && (
                <Link to="/family/questions" className={`${textLinkClass} self-start`}>
                  {t('results.answer')}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Disclosure>
  );
}
