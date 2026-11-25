import {
  ApiError,
  answerCanBeUnknown,
  questionFlow,
  routes,
  type CaseQuestions,
  type CaseView,
  type QuestionId,
  type QuestionStep,
} from '@arca/api-contract/client';
import type { Messages } from '@arca/i18n';
import { Button } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { casePlaybackQuery, caseQuery, caseQuestionsQuery, sessionQuery } from '../api.js';
import { caseFailure, writeCase, type CaseFailure } from '../case.js';
import { SelectField } from '../forms/select-field.js';
import { textLinkClass } from '../forms/text-link.js';
import { Page } from '../page.js';
import { passkeys } from '../platform.js';
import { QuestionEditor, type QuestionContext, businessesOf } from '../questions/editors.js';
import { sentAnswer } from '../questions/entry.js';
import { CaseSummary } from '../questions/playback.js';

export const Route = createFileRoute('/family_/questions')({ component: Questions });

type PersonQuestions = CaseQuestions['people'][number];
type Hinted = keyof Messages['questions']['hint'];

const definitions = new Map(questionFlow.map((question) => [question.id, question]));
const answered = (value: unknown) => value !== undefined;

/** The guided questions (spec 0007, R4): one step at a time, for each person the viewer keeps. */
function Questions() {
  const { t } = useTranslation();
  const session = useQuery(sessionQuery);
  const confirmed = session.data?.confirmed === true;
  const familyCase = useQuery({ ...caseQuery, enabled: confirmed });
  const questions = useQuery({ ...caseQuestionsQuery, enabled: confirmed });
  const title = t('questions.title');
  if (session.isError) {
    return (
      <Page narrow title={title}>
        <p>{t('questions.signIn')}</p>
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
  const outside =
    familyCase.data?.case === null ||
    (questions.error instanceof ApiError && questions.error.status === 404);
  if (outside) {
    return (
      <Page narrow title={title}>
        <p>{t('questions.noCase')}</p>
        <Link to="/family" className={textLinkClass}>
          {t('family.title')}
        </Link>
      </Page>
    );
  }
  if (familyCase.isError || questions.isError) {
    return (
      <Page narrow title={title}>
        <p>{t('questions.loadFailure')}</p>
        <Button
          onClick={() => {
            void familyCase.refetch();
            void questions.refetch();
          }}
        >
          {t('questions.retry')}
        </Button>
      </Page>
    );
  }
  const view = familyCase.data?.case;
  if (view === undefined || view === null || questions.data === undefined) {
    return <Page title={title} />;
  }
  return (
    <Page title={title} lead={t('questions.lead')}>
      {questions.data.people.length === 0 ? (
        <>
          <p>{t('questions.noneKept')}</p>
          <Link to="/family" className={textLinkClass}>
            {t('questions.back')}
          </Link>
        </>
      ) : (
        <Answering view={view} questions={questions.data} />
      )}
    </Page>
  );
}

/** The first step with a question still open, or the first step. */
const openStep = (person: PersonQuestions): QuestionStep =>
  (
    person.steps.find((step) => step.questions.some((question) => !answered(question.answer))) ??
    person.steps[0]
  )?.id ?? 'basics';

const answeredIn = (questions: readonly { readonly answer?: unknown }[]) =>
  questions.filter((question) => answered(question.answer)).length;

type Direction = 'next' | 'back';
const backValue: Direction = 'back';

const personClass =
  'flex min-h-touch items-center gap-2 rounded-control border border-line px-3 font-medium transition-colors hover:bg-soft aria-[current]:border-primary aria-[current]:bg-primary aria-[current]:text-on-primary sm:border-transparent';

function Answering({
  view,
  questions,
}: {
  readonly view: CaseView;
  readonly questions: CaseQuestions;
}) {
  const { t } = useTranslation();
  const names = new Map(view.people.map((person) => [person.id, person.displayName]));
  const first =
    questions.people.find(({ personId }) => personId === view.me) ?? questions.people[0];
  const [personId, setPersonId] = useState(first?.personId ?? '');
  const person = questions.people.find((entry) => entry.personId === personId) ?? first;
  const [step, setStep] = useState<QuestionStep>(() =>
    person === undefined ? 'basics' : openStep(person),
  );
  const [saved, setSaved] = useState(false);
  const [summary, setSummary] = useState(false);
  const go = (next: QuestionStep) => {
    setStep(next);
    setSaved(false);
  };
  if (person === undefined) return null;
  const links = (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <button
        type="button"
        className={textLinkClass}
        onClick={() => {
          setSummary(!summary);
        }}
      >
        {summary ? t('playback.hide') : t('playback.show')}
      </button>
      <Link to="/family/intake" className={textLinkClass}>
        {t('intake.open')}
      </Link>
      <Link to="/family" className={textLinkClass}>
        {t('questions.back')}
      </Link>
    </div>
  );
  if (summary) {
    return (
      <div className="flex flex-col gap-6">
        {links}
        <h3 className="font-display text-lead">{t('playback.title')}</h3>
        <CaseSummary
          people={view.people}
          kept={new Set(questions.people.map((entry) => entry.personId))}
          onPick={(chosen, question) => {
            setPersonId(chosen);
            go(definitions.get(question)?.step ?? 'basics');
            setSummary(false);
          }}
        />
      </div>
    );
  }
  const at = person.steps.findIndex(({ id }) => id === step);
  const current = person.steps[at] ?? person.steps[0];
  if (current === undefined) return null;
  const context: QuestionContext = {
    personId: person.personId,
    names,
    countries: questions.countries,
    formerCountries: questions.formerCountries,
    occupations: questions.occupations,
    businesses: businessesOf(
      person.steps.flatMap((entry) => entry.questions).find((question) => question.id === 'assets')
        ?.answer,
    ),
    studyFields: questions.studyFields,
  };
  const choosePerson = (chosen: string) => {
    setPersonId(chosen);
    const next = questions.people.find((entry) => entry.personId === chosen);
    if (next !== undefined) go(openStep(next));
  };
  return (
    <div className="flex min-w-0 flex-col gap-5">
      {questions.people.length > 1 && (
        <nav aria-label={t('questions.person')} className="flex items-center gap-3">
          <h3 className="shrink-0 text-small text-muted max-sm:sr-only">{t('questions.person')}</h3>
          <ul className="-mx-1 flex min-w-0 gap-1 overflow-x-auto rounded-control px-1 py-1 sm:border sm:border-line sm:bg-surface">
            {questions.people.map((entry) => {
              const all = entry.steps.flatMap(({ questions: asked }) => asked);
              return (
                <li key={entry.personId} className="shrink-0">
                  <button
                    type="button"
                    aria-current={entry.personId === person.personId ? 'true' : undefined}
                    className={personClass}
                    onClick={() => {
                      choosePerson(entry.personId);
                    }}
                  >
                    {names.get(entry.personId) ?? ''}
                    <span className="text-small opacity-70">
                      {t('questions.stepProgress', {
                        answered: answeredIn(all),
                        total: all.length,
                      })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      <nav aria-label={t('questions.stepsTitle')}>
        <div className="flex flex-col gap-2 lg:hidden">
          <SelectField
            label={t('questions.stepsTitle')}
            labelHidden
            value={current.id}
            options={person.steps.map(({ id, questions: asked }, index) => ({
              value: id,
              label: t('questions.stepOption', {
                position: index + 1,
                steps: person.steps.length,
                step: t(`questions.steps.${id}`),
                answered: answeredIn(asked),
                total: asked.length,
              }),
            }))}
            onChange={(chosen) => {
              const found = person.steps.find(({ id }) => id === chosen);
              if (found !== undefined) go(found.id);
            }}
          />
          <div className="h-1.5 overflow-hidden rounded-full bg-track" aria-hidden>
            <div
              className="h-full bg-accent"
              style={{ width: `${String(((at + 1) / person.steps.length) * 100)}%` }}
            />
          </div>
        </div>
        <ol
          className="grid gap-2 max-lg:hidden"
          style={{ gridTemplateColumns: `repeat(${String(person.steps.length)}, minmax(0, 1fr))` }}
        >
          {person.steps.map(({ id, questions: asked }) => {
            const done = asked.length > 0 && answeredIn(asked) === asked.length;
            return (
              <li key={id} className="flex">
                <button
                  type="button"
                  aria-current={id === current.id ? 'step' : undefined}
                  className={`flex min-h-touch w-full flex-col border-t-4 pt-2 text-left hover:text-ink aria-[current=step]:border-accent aria-[current=step]:font-medium ${done ? 'border-ok-ink' : 'border-line'}`}
                  onClick={() => {
                    go(id);
                  }}
                >
                  <span>{t(`questions.steps.${id}`)}</span>
                  <span className="text-small font-normal text-muted">
                    {t('questions.progress', {
                      answered: answeredIn(asked),
                      total: asked.length,
                    })}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <StepForm
        key={`${person.personId}:${current.id}`}
        name={names.get(person.personId) ?? ''}
        step={current}
        position={at + 1}
        steps={person.steps.length}
        context={context}
        next={person.steps[at + 1]?.id}
        first={at === 0}
        onSaved={(direction) => {
          const next = person.steps[direction === 'back' ? at - 1 : at + 1];
          if (next !== undefined) setStep(next.id);
          setSaved(true);
        }}
      />
      <p role="status" className="text-muted">
        {saved ? t('questions.saved') : ''}
      </p>
      {links}
    </div>
  );
}

function StepForm({
  name,
  step,
  position,
  steps,
  context,
  next,
  first,
  onSaved,
}: {
  readonly name: string;
  readonly step: PersonQuestions['steps'][number];
  readonly position: number;
  readonly steps: number;
  readonly context: QuestionContext;
  readonly next: QuestionStep | undefined;
  readonly first: boolean;
  /** After the step is saved, by the button that sent it: on to the next step, or back. */
  readonly onSaved: (direction: Direction) => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<ReadonlyMap<QuestionId, unknown>>(
    () => new Map(step.questions.map((question) => [question.id, question.answer])),
  );
  const [saved] = useState<ReadonlyMap<QuestionId, unknown>>(
    () => new Map(step.questions.map((question) => [question.id, question.answer])),
  );
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<CaseFailure>();
  return (
    <form
      className="flex flex-col rounded-card border border-line bg-surface"
      aria-label={t(`questions.steps.${step.id}`)}
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        const direction: Direction =
          event.nativeEvent.submitter?.getAttribute('value') === backValue ? 'back' : 'next';
        setFailure(undefined);
        setPending(true);
        writeCase(passkeys, routes.answerCaseQuestions, {
          personId: context.personId,
          answers: step.questions.map(({ id }) => ({
            questionId: id,
            answer: sentAnswer(drafts.get(id) ?? null, saved.get(id)),
          })),
        })
          .then(async (updated) => {
            queryClient.setQueryData(caseQuery.queryKey, { case: updated });
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: caseQuestionsQuery.queryKey }),
              queryClient.invalidateQueries({ queryKey: casePlaybackQuery.queryKey }),
            ]);
            onSaved(direction);
          })
          .catch((error: unknown) => {
            setFailure(caseFailure(error));
          })
          .finally(() => {
            setPending(false);
          });
      }}
    >
      <h3 className="sr-only">{t(`questions.steps.${step.id}`)}</h3>
      <div className="flex flex-col divide-y divide-line">
        {step.questions.map((asked) => {
          const definition = definitions.get(asked.id);
          if (definition === undefined) return null;
          const hintKey = `questions.hint.${asked.id}`;
          const legend = t(`questions.asked.${asked.id}`, { name });
          const hint = i18n.exists(hintKey) ? t(`questions.hint.${asked.id as Hinted}`) : undefined;
          return (
            <div
              key={asked.id}
              className="grid gap-x-10 gap-y-3 px-4 py-5 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:px-6"
            >
              {/* The editor keeps the question and hint as its own label for screen readers. */}
              <div aria-hidden className="flex flex-col gap-1">
                <p className="font-medium">{legend}</p>
                {hint !== undefined && <p className="text-small text-muted">{hint}</p>}
              </div>
              <div className="min-w-0">
                <QuestionEditor
                  questionId={asked.id}
                  input={definition.input}
                  legend={legend}
                  {...(hint === undefined ? {} : { hint })}
                  value={drafts.get(asked.id)}
                  {...(asked.related === undefined ? {} : { related: asked.related })}
                  canBeUnknown={answerCanBeUnknown(definition)}
                  context={context}
                  onChange={(value) => {
                    setDrafts((before) => new Map(before).set(asked.id, value));
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="sticky bottom-[var(--shell-bottom,0px)] z-10 flex flex-wrap items-center gap-3 rounded-b-card border-t border-line bg-soft px-4 py-3 md:px-6">
        <p
          className={`text-small max-sm:w-full sm:mr-auto ${failure === undefined && !pending ? 'text-muted max-sm:sr-only' : 'text-ink'}`}
        >
          <span role="status">
            {pending
              ? t('family.saving')
              : failure === undefined
                ? ''
                : t('questions.failure', { reason: failure })}
          </span>
          {!pending &&
            failure === undefined &&
            t('questions.position', {
              position,
              steps,
              answered: answeredIn(step.questions),
              total: step.questions.length,
            })}
        </p>
        {!first && (
          <span className="max-sm:shrink-0">
            <Button type="submit" value={backValue} variant="secondary" disabled={pending}>
              {t('questions.previous')}
            </Button>
          </span>
        )}
        <span className="max-sm:flex max-sm:flex-1 max-sm:*:flex-1">
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {next === undefined
              ? t('questions.save')
              : t('questions.next', { step: t(`questions.steps.${next}`) })}
          </Button>
        </span>
      </div>
    </form>
  );
}
