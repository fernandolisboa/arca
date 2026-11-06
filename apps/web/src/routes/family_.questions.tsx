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
import { Button, ChoiceGroup } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { caseQuery, caseQuestionsQuery, sessionQuery } from '../api.js';
import { caseFailure, writeCase, type CaseFailure } from '../case.js';
import { textLinkClass } from '../forms/text-link.js';
import { Page } from '../page.js';
import { passkeys } from '../platform.js';
import { QuestionEditor, sentAnswer, type QuestionContext } from '../questions/editors.js';

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
      <Page title={title}>
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
      <Page title={title}>
        <p>{t('session.unconfirmed')}</p>
      </Page>
    );
  }
  const outside =
    familyCase.data?.case === null ||
    (questions.error instanceof ApiError && questions.error.status === 404);
  if (outside) {
    return (
      <Page title={title}>
        <p>{t('questions.noCase')}</p>
        <Link to="/family" className={textLinkClass}>
          {t('family.title')}
        </Link>
      </Page>
    );
  }
  if (familyCase.isError || questions.isError) {
    return (
      <Page title={title}>
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
        <p>{t('questions.noneKept')}</p>
      ) : (
        <Answering view={view} questions={questions.data} />
      )}
      <Link to="/family" className={textLinkClass}>
        {t('questions.back')}
      </Link>
    </Page>
  );
}

/** The first step with a question still open, or the first step. */
const openStep = (person: PersonQuestions): QuestionStep =>
  (
    person.steps.find((step) => step.questions.some((question) => !answered(question.answer))) ??
    person.steps[0]
  )?.id ?? 'basics';

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
  const go = (next: QuestionStep) => {
    setStep(next);
    setSaved(false);
  };
  if (person === undefined) return null;
  const at = person.steps.findIndex(({ id }) => id === step);
  const current = person.steps[at] ?? person.steps[0];
  if (current === undefined) return null;
  const context: QuestionContext = {
    personId: person.personId,
    names,
    countries: questions.countries,
    formerCountries: questions.formerCountries,
  };
  return (
    <div className="flex flex-col gap-6">
      {questions.people.length > 1 && (
        <ChoiceGroup
          legend={t('questions.person')}
          choices={questions.people.map((entry) => ({
            value: entry.personId,
            label: names.get(entry.personId) ?? '',
          }))}
          value={person.personId}
          onChange={(chosen) => {
            setPersonId(chosen);
            const next = questions.people.find((entry) => entry.personId === chosen);
            if (next !== undefined) go(openStep(next));
          }}
        />
      )}
      <nav aria-label={t('questions.stepsTitle')}>
        <ol className="flex flex-wrap gap-2">
          {person.steps.map(({ id, questions: asked }) => (
            <li key={id}>
              <button
                type="button"
                aria-current={id === current.id ? 'step' : undefined}
                className="flex min-h-touch flex-col rounded-control border border-line px-3 py-1 text-left aria-[current=step]:border-primary aria-[current=step]:bg-soft"
                onClick={() => {
                  go(id);
                }}
              >
                <span className="font-medium">{t(`questions.steps.${id}`)}</span>
                <span className="text-small text-muted">
                  {t('questions.progress', {
                    answered: asked.filter((question) => answered(question.answer)).length,
                    total: asked.length,
                  })}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <StepForm
        key={`${person.personId}:${current.id}`}
        name={names.get(person.personId) ?? ''}
        step={current}
        context={context}
        last={at === person.steps.length - 1}
        onSaved={() => {
          const next = person.steps[at + 1];
          if (next !== undefined) setStep(next.id);
          setSaved(true);
        }}
      />
      <p role="status" className="text-muted">
        {saved ? t('questions.saved') : ''}
      </p>
    </div>
  );
}

function StepForm({
  name,
  step,
  context,
  last,
  onSaved,
}: {
  readonly name: string;
  readonly step: PersonQuestions['steps'][number];
  readonly context: QuestionContext;
  readonly last: boolean;
  readonly onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<ReadonlyMap<QuestionId, unknown>>(
    () => new Map(step.questions.map((question) => [question.id, question.answer])),
  );
  const saved = new Map(step.questions.map((question) => [question.id, question.answer]));
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<CaseFailure>();
  return (
    <form
      className="flex flex-col gap-6"
      aria-label={t(`questions.steps.${step.id}`)}
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
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
            await queryClient.invalidateQueries({ queryKey: caseQuestionsQuery.queryKey });
            onSaved();
          })
          .catch((error: unknown) => {
            setFailure(caseFailure(error));
          })
          .finally(() => {
            setPending(false);
          });
      }}
    >
      <h3 className="font-display text-lead">{t(`questions.steps.${step.id}`)}</h3>
      {step.questions.map((asked) => {
        const definition = definitions.get(asked.id);
        if (definition === undefined) return null;
        const hintKey = `questions.hint.${asked.id}`;
        return (
          <QuestionEditor
            key={asked.id}
            input={definition.input}
            legend={t(`questions.asked.${asked.id}`, { name })}
            {...(i18n.exists(hintKey) ? { hint: t(`questions.hint.${asked.id as Hinted}`) } : {})}
            value={drafts.get(asked.id)}
            {...(asked.related === undefined ? {} : { related: asked.related })}
            canBeUnknown={answerCanBeUnknown(definition)}
            context={context}
            onChange={(value) => {
              setDrafts((before) => new Map(before).set(asked.id, value));
            }}
          />
        );
      })}
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {last ? t('questions.save') : t('questions.next')}
      </Button>
      <p role="status" className={failure === undefined ? 'text-muted' : 'text-ink'}>
        {pending
          ? t('family.saving')
          : failure === undefined
            ? ''
            : t('questions.failure', { reason: failure })}
      </p>
    </form>
  );
}
