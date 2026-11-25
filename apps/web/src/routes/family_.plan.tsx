import {
  ApiError,
  type CaseEvaluations,
  type CaseView,
  type FamilyPlan,
  routes,
} from '@arca/api-contract/client';
import { Button, StatusChip, cardClass } from '@arca/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { api, caseEvaluationsQuery, caseQuery, familyPlanQuery, sessionQuery } from '../api.js';
import { FlagLead } from '../country-flag.js';
import { textLinkClass } from '../forms/text-link.js';
import { type KnowledgeWords, useKnowledgeWords } from '../knowledge/words.js';
import { Page, stickyColumnClass } from '../page.js';
import { type PlanPerson, MoveEditor } from '../plan/move-editor.js';
import { type WrittenMove, stagesOf, withMove, withoutMove, writtenMoves } from '../plan/moves.js';
import { reach, UnreachableError } from '../requests.js';
import { shownTotals } from '../results/amount.js';
import { type RouteRow, resultRows } from '../results/group.js';
import { RouteDetail, amountText, totalShort } from '../results/route-detail.js';
import { statusTones } from '../results/status-tone.js';
import { useMediaQuery } from '../use-media-query.js';

export function planSearch(search: Record<string, unknown>): {
  route?: string;
  person?: string;
} {
  const { route, person } = search;
  return {
    ...(typeof route === 'string' ? { route } : {}),
    ...(typeof person === 'string' ? { person } : {}),
  };
}

export const Route = createFileRoute('/family_/plan')({
  validateSearch: planSearch,
  component: FamilyPlanPage,
});

/** The family plan (ADR-0040): each person's route, who goes along, and who goes first. */
function FamilyPlanPage() {
  const words = useKnowledgeWords();
  const { t } = words;
  const session = useQuery(sessionQuery);
  const confirmed = session.data?.confirmed === true;
  const familyCase = useQuery({ ...caseQuery, enabled: confirmed });
  const plan = useQuery({ ...familyPlanQuery, enabled: confirmed });
  const evaluations = useQuery({ ...caseEvaluationsQuery, enabled: confirmed });
  const title = t('plan.title');
  const back = (
    <Link to="/family" className={`${textLinkClass} self-start`}>
      {t('plan.back')}
    </Link>
  );
  if (session.isError) {
    return (
      <Page narrow title={title}>
        <p>{t('plan.signIn')}</p>
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
  const status = (error: unknown) => (error instanceof ApiError ? error.status : undefined);
  if (familyCase.data?.case === null || status(plan.error) === 404) {
    return (
      <Page narrow title={title}>
        <p>{t('plan.noCase')}</p>
        {back}
      </Page>
    );
  }
  if (familyCase.isError || plan.isError || evaluations.isError) {
    const limited = status(plan.error) === 429 || status(evaluations.error) === 429;
    return (
      <Page narrow title={title}>
        <p role="alert">{t(limited ? 'plan.tooMany' : 'plan.loadFailure')}</p>
        <Button
          onClick={() => {
            void familyCase.refetch();
            void plan.refetch();
            void evaluations.refetch();
          }}
        >
          {t('plan.retry')}
        </Button>
        {back}
      </Page>
    );
  }
  const view = familyCase.data?.case;
  if (view === undefined || plan.data === undefined || evaluations.data === undefined) {
    return <Page title={title} />;
  }
  return (
    <Page title={title} lead={t('plan.lead', { date: words.date(plan.data.rulesAsOf) })}>
      <PlanBoard view={view} plan={plan.data} evaluations={evaluations.data} words={words} />
      {back}
    </Page>
  );
}

/** Wide enough for the stages beside the side panel. */
const wideQuery = '(min-width: 64rem)';

type Panel =
  | { readonly kind: 'none' }
  | { readonly kind: 'detail'; readonly index: number }
  | { readonly kind: 'edit'; readonly index: number | null; readonly initial: WrittenMove };

function PlanBoard({
  view,
  plan,
  evaluations,
  words,
}: {
  readonly view: CaseView;
  readonly plan: FamilyPlan;
  readonly evaluations: CaseEvaluations;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const wide = useMediaQuery(wideQuery);
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const names = new Map(view.people.map((person) => [person.id, person.displayName]));
  const name = (id: string) => names.get(id) ?? t('results.someone');
  const people: PlanPerson[] = view.people.map((person) => ({
    id: person.id,
    name: person.displayName,
    inPlanning: person.caseMember,
  }));
  const { rows } = resultRows(evaluations.results, words.country, words.language);
  const moves = writtenMoves(plan);
  const fresh = (patch: Partial<WrittenMove> = {}): WrittenMove => ({
    stage: 1,
    routeId: '',
    principalId: '',
    dependentIds: [],
    ...patch,
  });
  // A link from a route's detail opens a new move with that route and person.
  const linked =
    search.route !== undefined &&
    search.person !== undefined &&
    rows.some(({ routeId }) => routeId === search.route) &&
    people.some(({ id, inPlanning }) => id === search.person && inPlanning);
  const [panel, setPanel] = useState<Panel>(() =>
    linked
      ? {
          kind: 'edit',
          index: null,
          initial: fresh({ routeId: search.route ?? '', principalId: search.person ?? '' }),
        }
      : { kind: 'none' },
  );
  const saved = useMutation({
    mutationFn: (next: readonly WrittenMove[]) =>
      reach(api.call(routes.writeFamilyPlan, { revision: plan.revision, moves: [...next] })),
    onSuccess: (answer) => {
      queryClient.setQueryData(familyPlanQuery.queryKey, answer);
      setPanel({ kind: 'none' });
    },
    onError: (error) => {
      if (saveFailureReason(error) === 'changed') {
        void queryClient.invalidateQueries({ queryKey: familyPlanQuery.queryKey });
      }
    },
  });
  const failure =
    saved.error === null
      ? undefined
      : t('plan.saveFailure', { reason: saveFailureReason(saved.error) });
  const save = (next: readonly WrittenMove[]) => {
    saved.mutate(next);
  };
  const stages = stagesOf(plan);
  const selected = panel.kind === 'detail' ? plan.moves[panel.index] : undefined;
  const side =
    panel.kind === 'edit' ? (
      <MoveEditor
        key={panel.index ?? 'new'}
        moves={moves}
        editing={panel.index}
        initial={panel.initial}
        people={people}
        rows={rows}
        evaluations={evaluations}
        saving={saved.isPending}
        failure={failure}
        onSave={(move) => {
          save(withMove(moves, panel.index, move));
        }}
        onCancel={() => {
          saved.reset();
          setPanel({ kind: 'none' });
        }}
        words={words}
      />
    ) : selected !== undefined && selected.result.route !== null ? (
      <RouteDetail
        row={detailRow(selected)}
        principalId={selected.result.principalId}
        plannable={false}
        name={name}
        words={words}
      />
    ) : (
      <Guide words={words} />
    );
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,30rem)] lg:gap-8">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => {
              saved.reset();
              setPanel({ kind: 'edit', index: null, initial: fresh() });
            }}
          >
            {t('plan.add')}
          </Button>
          <p className="text-small text-muted">{t('plan.shared')}</p>
        </div>
        {!wide && panel.kind !== 'none' && (
          <div className={`${cardClass} flex flex-col gap-4 p-4`}>
            {side}
            {panel.kind === 'detail' && (
              <Button
                variant="secondary"
                onClick={() => {
                  setPanel({ kind: 'none' });
                }}
              >
                {t('plan.closeDetail')}
              </Button>
            )}
          </div>
        )}
        <Summary plan={plan} name={name} words={words} />
        {stages.length === 0 ? (
          <p className="text-muted">{t('plan.empty')}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {stages.map(({ stage, moves: inStage }, at) => (
              <section
                key={stage}
                aria-labelledby={`plan-stage-${String(stage)}`}
                className="flex min-w-0 flex-col gap-3"
              >
                <header>
                  <h3 id={`plan-stage-${String(stage)}`} className="font-display text-lead">
                    {t('plan.stage', { n: stage })}
                  </h3>
                  <p className="text-small text-muted">
                    {at === 0
                      ? t('plan.stageFirst')
                      : t('plan.stageLater', { previous: stages[at - 1]?.stage ?? stage - 1 })}
                  </p>
                </header>
                <ul className="flex flex-col gap-3">
                  {inStage.map(({ index, move }) => (
                    <MoveCard
                      key={`${move.result.routeId}:${move.result.principalId}`}
                      move={move}
                      selected={panel.kind !== 'none' && panel.index === index}
                      onDetail={() => {
                        setPanel({ kind: 'detail', index });
                      }}
                      onEdit={() => {
                        saved.reset();
                        const initial = moves[index];
                        if (initial !== undefined) setPanel({ kind: 'edit', index, initial });
                      }}
                      onRemove={() => {
                        save(withoutMove(moves, index));
                      }}
                      removing={saved.isPending}
                      name={name}
                      words={words}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        {panel.kind !== 'edit' && failure !== undefined && (
          <p role="alert" className="text-small text-danger-ink">
            {failure}
          </p>
        )}
      </div>
      {wide && (
        <aside
          aria-label={t('plan.sideTitle')}
          className={`${cardClass} flex min-w-0 flex-col gap-4 p-4 ${stickyColumnClass}`}
        >
          {side}
        </aside>
      )}
    </div>
  );
}

/** Why a save failed, as the failure message says it. */
function saveFailureReason(
  error: Error,
): 'changed' | 'invalid' | 'limited' | 'unreachable' | 'other' {
  if (error instanceof UnreachableError) return 'unreachable';
  if (!(error instanceof ApiError)) return 'other';
  if (error.code === 'plan_changed') return 'changed';
  if (error.status === 409) return 'invalid';
  return error.status === 429 ? 'limited' : 'other';
}

/** One move as the results' detail panel reads a route: its single result. */
function detailRow(move: FamilyPlan['moves'][number]): RouteRow {
  const route = move.result.route;
  if (route === null) throw new Error('A move without an active version has no detail');
  return { routeId: move.result.routeId, route, results: [move.result], best: move.result.status };
}

function Summary({
  plan,
  name,
  words,
}: {
  readonly plan: FamilyPlan;
  readonly name: (id: string) => string;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const { certain, extra } = shownTotals(plan.totals);
  return (
    <section
      aria-label={t('plan.summaryTitle')}
      className={`${cardClass} grid gap-4 p-4 sm:grid-cols-2`}
    >
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">{t('plan.totalTitle')}</h3>
        <p className="font-display text-lead tabular-nums">
          {certain.length === 0
            ? t('plan.noTotal')
            : certain.map((form) => amountText(form, words)).join(' + ')}
        </p>
        {extra.length > 0 && (
          <p className="text-small">
            {t('results.totalExtra', {
              amount: extra.map((form) => amountText(form, words)).join(' + '),
            })}
          </p>
        )}
        <p className="text-small text-muted">{t('plan.totalHow')}</p>
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">{t('plan.peopleTitle')}</h3>
        <p className="text-small">
          {plan.unplanned.length === 0
            ? t('plan.allPlanned')
            : t('plan.unplanned', { names: words.list(plan.unplanned.map(name)) })}
        </p>
      </div>
    </section>
  );
}

function MoveCard({
  move,
  selected,
  onDetail,
  onEdit,
  onRemove,
  removing,
  name,
  words,
}: {
  readonly move: FamilyPlan['moves'][number];
  readonly selected: boolean;
  readonly onDetail: () => void;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
  readonly removing: boolean;
  readonly name: (id: string) => string;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const { result, dependents, principalGoesFrom } = move;
  const left = dependents.filter(({ fit }) => fit === 'not_covered');
  const open = dependents.filter(({ fit }) => fit === 'possible');
  const total = totalShort(result, words);
  const title = result.route?.title ?? t('plan.noVersion');
  return (
    <li
      aria-current={selected ? 'true' : undefined}
      className={`${cardClass} flex flex-col gap-2 p-4 ${selected ? 'border-primary' : ''}`}
    >
      {result.route !== null && (
        <p className="text-small text-muted">
          <FlagLead code={result.route.country} />
          {words.country(result.route.country)}
        </p>
      )}
      <h4 className="font-medium break-words">{title}</h4>
      <p className="text-small">
        {t('plan.principal', { name: name(result.principalId) })}
        {' · '}
        {dependents.length === 0
          ? t('plan.takesNobody')
          : t('plan.takes', {
              names: words.list(dependents.map(({ personId }) => name(personId))),
            })}
      </p>
      {principalGoesFrom !== null && (
        <p className="text-small text-muted">
          {t('plan.alreadyThere', { name: name(result.principalId), stage: principalGoesFrom })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip
          tone={statusTones[result.status]}
          label={t('results.status', { status: result.status })}
        />
        {total !== null && <span className="text-small tabular-nums">{total}</span>}
      </div>
      {left.length > 0 && (
        <p className="text-small text-danger-ink">
          {t('plan.notCovered', { names: words.list(left.map(({ personId }) => name(personId))) })}
        </p>
      )}
      {open.length > 0 && (
        <p className="text-small text-warn-ink">
          {t('plan.maybeCovered', {
            names: words.list(open.map(({ personId }) => name(personId))),
          })}
        </p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {result.route !== null && (
          <button type="button" className={textLinkClass} onClick={onDetail}>
            {t('plan.details')}
          </button>
        )}
        {result.status !== 'unavailable' && result.status !== 'pending_activation' && (
          <Link
            to="/family/documents"
            search={{ route: result.routeId, person: result.principalId }}
            className={textLinkClass}
          >
            {t('plan.documents')}
          </Link>
        )}
        <button type="button" className={textLinkClass} onClick={onEdit}>
          {t('plan.edit')}
        </button>
        <button type="button" className={textLinkClass} onClick={onRemove} disabled={removing}>
          {t('plan.remove')}
        </button>
      </div>
    </li>
  );
}

/** What the side shows before anything is picked: how a plan is put together. */
function Guide({ words }: { readonly words: KnowledgeWords }) {
  const { t } = words;
  return (
    <div className="flex flex-col gap-3 text-small">
      <h3 className="font-display text-lead">{t('plan.guideTitle')}</h3>
      <p>{t('plan.guideMoves')}</p>
      <p>{t('plan.guideStages')}</p>
      <h4 className="font-medium">{t('plan.reunionTitle')}</h4>
      <p>{t('plan.reunion')}</p>
    </div>
  );
}
