import {
  ApiError,
  type CaseEvaluations,
  type CaseView,
  type RouteResult,
  staleAfterDays,
} from '@arca/api-contract/client';
import { Button, SourceLine, StatusChip } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useLocation } from '@tanstack/react-router';
import { type ReactNode, useEffect, useId } from 'react';
import { caseEvaluationsQuery, caseQuery, sessionQuery } from '../api.js';
import { textLinkClass } from '../forms/text-link.js';
import { useKnowledgeWords, type KnowledgeWords } from '../knowledge/words.js';
import { Page, PageColumns } from '../page.js';
import { groupResults, resultsAnchor } from '../results/group.js';
import { ReportRule } from '../results/report-rule.js';
import { statusTones } from '../results/status-tone.js';

export const Route = createFileRoute('/family_/results')({ component: Results });

type Source = RouteResult['requirements'][number]['sources'][number];

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
      <Evaluated view={view} evaluations={evaluations.data} words={words} />
      {back}
    </Page>
  );
}

function Evaluated({
  view,
  evaluations,
  words,
}: {
  readonly view: CaseView;
  readonly evaluations: CaseEvaluations;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const names = new Map(view.people.map((person) => [person.id, person.displayName]));
  const name = (id: string) => names.get(id) ?? t('results.someone');
  const people = (ids: readonly string[]) => words.list(ids.map(name));
  const groups = groupResults(evaluations.results, words.country, words.language);
  const { hash } = useLocation();
  // A link from another screen, such as the comparison, lands on its country once the list exists.
  useEffect(() => {
    if (hash !== '') document.getElementById(hash)?.scrollIntoView();
  }, [hash]);
  return (
    <PageColumns
      side={
        <section aria-labelledby="results-questions" className="flex flex-col gap-3">
          <h3 id="results-questions" className="font-display text-lead">
            {t('results.questionsTitle')}
          </h3>
          {evaluations.questions.length === 0 ? (
            <p className="text-muted">{t('results.noQuestions')}</p>
          ) : (
            <>
              <p className="text-muted">{t('results.questionsLead')}</p>
              <ul className="flex flex-col gap-3">
                {evaluations.questions.map((question) => {
                  const asked = t(`questions.asked.${question.question}`, {
                    name: name(question.personId),
                  });
                  return (
                    <li
                      key={`${question.personId}:${question.question}`}
                      className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4"
                    >
                      <p>
                        {question.kept
                          ? asked
                          : t('results.askKeeper', {
                              name: name(question.personId),
                              question: asked,
                            })}
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
            </>
          )}
        </section>
      }
    >
      {groups.length === 0 && <p className="text-muted">{t('results.empty')}</p>}
      {groups.map(({ country, routes }) => {
        const heading = country === null ? t('results.otherRoutes') : words.country(country);
        return (
          <section
            key={country ?? ''}
            id={country === null ? undefined : resultsAnchor(country)}
            aria-label={heading}
            className="flex scroll-mt-20 flex-col gap-3"
          >
            <h3 className="font-display text-lead">{heading}</h3>
            <div className="grid items-start gap-3 xl:grid-cols-2">
              {routes.map((group) => {
                const routeTitle =
                  group.route?.title ?? t('results.unnamedRoute', { id: group.routeId });
                return (
                  <article
                    key={group.routeId}
                    aria-label={routeTitle}
                    className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
                  >
                    <h4 className="font-medium break-words">{routeTitle}</h4>
                    {group.results.map((result) => (
                      <PrincipalResult
                        key={result.principalId}
                        result={result}
                        name={name}
                        people={people}
                        words={words}
                      />
                    ))}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </PageColumns>
  );
}

function PrincipalResult({
  result,
  name,
  people,
  words,
}: {
  readonly result: RouteResult;
  readonly name: (id: string) => string;
  readonly people: (ids: readonly string[]) => string;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const evaluated = result.status !== 'pending_activation' && result.status !== 'unavailable';
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <p>{t('results.principal', { name: name(result.principalId) })}</p>
        <StatusChip
          tone={statusTones[result.status]}
          label={t('results.status', { status: result.status })}
        />
      </div>
      {result.stale && (
        <p className="text-small text-warn-ink">{t('results.stale', { days: staleAfterDays })}</p>
      )}
      {result.closureSources.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-small">{t('results.closed')}</p>
          <Sources sources={result.closureSources} words={words} />
        </div>
      )}
      {result.newerProposedVersion !== null && (
        <p className="text-small text-muted">
          {t('results.newerVersion', { date: words.date(result.newerProposedVersion.from) })}
        </p>
      )}
      {evaluated && (
        <>
          {result.dependents.length === 0 && result.possibleDependents.length === 0 && (
            <p className="text-small">{t('results.nobodyWith')}</p>
          )}
          {result.dependents.length > 0 && (
            <p className="text-small">
              {t('results.goWith', { names: people(result.dependents) })}
            </p>
          )}
          {result.possibleDependents.length > 0 && (
            <p className="text-small">
              {t('results.mayGoWith', { names: people(result.possibleDependents) })}
            </p>
          )}
          {result.unitOpen && <p className="text-small text-muted">{t('results.unitOpen')}</p>}
          {result.missingRates.length > 0 && (
            <p className="text-small text-muted">
              {t('results.missingRates', {
                n: result.missingRates.length,
                pairs: words.list(result.missingRates.map((pair) => t('results.ratePair', pair))),
              })}
            </p>
          )}
          {result.missingDates.length > 0 && (
            <p className="text-small text-muted">
              {t('results.missingDates', {
                dates: words.list(result.missingDates.map(words.referenceDate)),
              })}
            </p>
          )}
          <details>
            <summary className={`${textLinkClass} cursor-pointer`}>{t('results.details')}</summary>
            <div className="mt-3 flex flex-col gap-4">
              <Rules
                title={t('results.requirementsTitle')}
                items={result.requirements}
                name={name}
                words={words}
                after={(requirement, lineId) =>
                  result.version !== null && (
                    <ReportRule
                      describedBy={lineId}
                      rule={{
                        routeId: result.routeId,
                        versionNumber: result.version.number,
                        requirementId: requirement.id,
                      }}
                    />
                  )
                }
              >
                {(requirement) =>
                  t('results.requirement', {
                    result:
                      requirement.result === true
                        ? 'yes'
                        : requirement.result === false
                          ? 'no'
                          : 'unknown',
                  })
                }
              </Rules>
              {result.assessments.length > 0 && (
                <Rules
                  title={t('results.assessmentsTitle')}
                  items={result.assessments}
                  name={name}
                  words={words}
                >
                  {() => t('results.assessmentNote')}
                </Rules>
              )}
              <Rules
                title={t('results.costsTitle')}
                items={result.costs.filter((cost) => cost.applies !== false)}
                name={name}
                words={words}
              >
                {(cost) => cost.applies === 'unknown' && t('results.costMaybe')}
              </Rules>
              {result.durations.length > 0 && (
                <Rules
                  title={t('results.durationsTitle')}
                  items={result.durations}
                  name={name}
                  words={words}
                >
                  {() => null}
                </Rules>
              )}
            </div>
          </details>
        </>
      )}
    </div>
  );
}

type Rule =
  | RouteResult['requirements'][number]
  | RouteResult['assessments'][number]
  | RouteResult['costs'][number]
  | RouteResult['durations'][number];

/** A line for each rule, with what it says of the case under it and every source (rule 1). */
function Rules<Item extends Rule>({
  title,
  items,
  name,
  words,
  children,
  after,
}: {
  readonly title: string;
  readonly items: readonly Item[];
  readonly name: (id: string) => string;
  readonly words: KnowledgeWords;
  readonly children: (item: Item) => ReactNode;
  /** Shown under the item's sources, such as the way to report it, given the item line's ID. */
  readonly after?: (item: Item, lineId: string) => ReactNode;
}) {
  const baseId = useId();
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h5 className="font-medium">{title}</h5>
      <ul className="flex flex-col gap-3">
        {items.map((item, index) => {
          const lineId = `${baseId}-${String(index)}`;
          return (
            <li
              key={'costId' in item ? `${item.costId}:${item.personId ?? ''}` : item.id}
              className="flex flex-col gap-1"
            >
              <p id={lineId}>{ruleLine(item, words, name)}</p>
              <p className="text-small text-muted">{children(item)}</p>
              <Sources sources={item.sources} words={words} />
              {after?.(item, lineId)}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ruleLine(item: Rule, words: KnowledgeWords, name: (id: string) => string): string {
  const { t } = words;
  if ('costId' in item) {
    const money = (amount: NonNullable<typeof item.min>) =>
      words.money(amount.amount, amount.currency);
    const { min, max } = item;
    const amount =
      max === null
        ? min === null
          ? t('results.amountUnknown')
          : t('results.amountFrom', { min: money(min) })
        : min === null
          ? t('results.amountUpTo', { max: money(max) })
          : min.amount === max.amount && min.currency === max.currency
            ? money(min)
            : t('results.amountRange', { min: money(min), max: money(max) });
    return item.personId === null
      ? t('results.cost', { title: item.title, amount })
      : t('results.costFor', { title: item.title, name: name(item.personId), amount });
  }
  if ('min' in item) {
    return t('results.duration', {
      title: item.title,
      min: words.duration(item.min),
      max: words.duration(item.max),
    });
  }
  return item.title;
}

function Sources({
  sources,
  words,
}: {
  readonly sources: readonly Source[];
  readonly words: KnowledgeWords;
}) {
  // The placeholders go back in, so the source line puts the link and the date in their place.
  const message = words.t('results.source', { host: '{host}', date: '{date}' });
  return (
    <>
      {sources.map((source) => (
        <SourceLine
          key={source.id}
          href={source.url}
          verifiedOn={source.verifiedAt}
          locale={words.language}
          message={message}
        />
      ))}
    </>
  );
}
