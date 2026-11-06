import {
  ApiError,
  isNewReference,
  maxIntakeTextLength,
  routes,
  type CaseIntakeDraftResponse,
  type CaseQuestions,
  type CaseView,
} from '@arca/api-contract/client';
import { Button, ChoiceGroup } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useId, useRef, useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, casePlaybackQuery, caseQuery, caseQuestionsQuery, sessionQuery } from '../api.js';
import { caseFailure, writeCase, type CaseFailure } from '../case.js';
import { CheckRow } from '../forms/check-row.js';
import { nameInput } from '../forms/inputs.js';
import { MembershipChoice } from '../forms/membership-choice.js';
import { TextField } from '../forms/text-field.js';
import { textLinkClass } from '../forms/text-link.js';
import {
  type IntakeChoices,
  type IntakeDraft,
  type IntakeList,
  type NewPerson,
  defaultChoices,
  edgeItems,
  listId,
  namesReady,
  personItems,
  storedAnswers,
  wholeList,
} from '../intake/plan.js';
import { type IntakeProgress, freshProgress, saveIntake } from '../intake/save.js';
import { Page } from '../page.js';
import { passkeys } from '../platform.js';
import { useNames } from '../questions/editors.js';
import { useSentenceText } from '../questions/playback.js';
import { commonFailure, reach, type CommonFailure } from '../requests.js';
import { toggled } from '../sets.js';

export const Route = createFileRoute('/family_/intake')({ component: Intake });

/** The intake screen (spec 0008, R4): the family in the member's own words, then a draft to review. */
function Intake() {
  const { t } = useTranslation();
  const session = useQuery(sessionQuery);
  const confirmed = session.data?.confirmed === true;
  const familyCase = useQuery({ ...caseQuery, enabled: confirmed });
  const questions = useQuery({ ...caseQuestionsQuery, enabled: confirmed });
  const title = t('intake.title');
  if (session.isError) {
    return (
      <Page title={title}>
        <p>{t('intake.signIn')}</p>
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
  if (familyCase.data?.case === null) {
    return (
      <Page title={title}>
        <p>{t('questions.noCase')}</p>
        <Link to="/family" className={textLinkClass}>
          {t('family.title')}
        </Link>
      </Page>
    );
  }
  // A failed refetch keeps the cached case, so a review in progress stays on screen.
  if (
    (familyCase.data === undefined && familyCase.isError) ||
    (questions.data === undefined && questions.isError)
  ) {
    return (
      <Page title={title}>
        <p>{t('intake.loadFailure')}</p>
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
  if (view === undefined || questions.data === undefined) return <Page title={title} />;
  return (
    <Page title={title} lead={t('intake.lead')}>
      <Drafting view={view} questions={questions.data} />
      <Link to="/family/questions" className={textLinkClass}>
        {t('intake.toQuestions')}
      </Link>
    </Page>
  );
}

const draftCodes = [
  'not_found',
  'intake_unavailable',
  'intake_timeout',
  'intake_unparsable',
  'intake_failed',
] as const;
type DraftCode = (typeof draftCodes)[number];
type DraftFailure = CommonFailure | DraftCode;

const isDraftCode = (code: string): code is DraftCode =>
  (draftCodes as readonly string[]).includes(code);

const draftFailure = (error: unknown): DraftFailure =>
  commonFailure(error, ({ code }: ApiError) => (isDraftCode(code) ? code : undefined));

function Drafting({
  view,
  questions,
}: {
  readonly view: CaseView;
  readonly questions: CaseQuestions;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<CaseIntakeDraftResponse>();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<DraftFailure>();
  const textId = useId();
  const hintId = useId();
  if (draft !== undefined) {
    return (
      <Review
        // A new draft starts its review afresh, with nothing saved yet.
        key={JSON.stringify(draft.draft)}
        draft={draft.draft}
        view={view}
        questions={questions}
        onRestart={() => {
          setDraft(undefined);
        }}
      />
    );
  }
  const length = text.trim().length;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        setFailure(undefined);
        setPending(true);
        reach(api.call(routes.draftCaseIntake, { text }))
          .then(setDraft)
          .catch((error: unknown) => {
            setFailure(draftFailure(error));
          })
          .finally(() => {
            setPending(false);
          });
      }}
    >
      <div className="flex flex-col gap-2 rounded-control border border-line bg-soft p-3">
        <p>{t('intake.privacy')}</p>
        <p className="text-small text-muted">{t('intake.tip')}</p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={textId} className="font-medium">
          {t('intake.label')}
        </label>
        <textarea
          id={textId}
          aria-describedby={hintId}
          rows={8}
          maxLength={maxIntakeTextLength}
          required
          value={text}
          placeholder={t('intake.placeholder')}
          className="rounded-control border border-line bg-surface p-3 text-body text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onChange={(event) => {
            setText(event.currentTarget.value);
          }}
        />
        <p id={hintId} className="text-small text-muted">
          {t('intake.count', { count: text.length, max: maxIntakeTextLength })}
        </p>
      </div>
      <Button type="submit" disabled={pending || length === 0} aria-busy={pending}>
        {t('intake.submit')}
      </Button>
      <p role="status" className={failure === undefined ? 'text-muted' : 'text-ink'}>
        {pending
          ? t('intake.drafting')
          : failure === undefined
            ? ''
            : t('intake.failure', { reason: failure })}
      </p>
    </form>
  );
}

const lists: readonly IntakeList[] = ['citizenships', 'languages'];

function Review({
  draft,
  view,
  questions,
  onRestart,
}: {
  readonly draft: IntakeDraft;
  readonly view: CaseView;
  readonly questions: CaseQuestions;
  readonly onRestart: () => void;
}) {
  const { t, i18n } = useTranslation();
  const labels = useNames();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [choices, setChoices] = useState<IntakeChoices>(() => defaultChoices(draft));
  const progressRef = useRef<IntakeProgress>(freshProgress());
  // A failed save keeps the choices it started with, so a retry finishes the same writes.
  const [locked, setLocked] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<CaseFailure>();
  const names = new Map(view.people.map(({ id, displayName }) => [id, displayName]));
  const nameOf = (ref: string): string => {
    const typed = choices.people.get(ref)?.displayName.trim() ?? '';
    if (typed !== '') return typed;
    const role = draft.people.find((person) => person.ref === ref)?.role ?? 'other';
    return names.get(ref) ?? t('intake.unnamed', { role });
  };
  const text = useSentenceText(new Map(draft.people.map(({ ref }) => [ref, nameOf(ref)])));
  const listFormat = new Intl.ListFormat(i18n.language, { type: 'conjunction' });
  const update = (change: Partial<IntakeChoices>) => {
    setChoices((before) => ({ ...before, ...change }));
  };
  const shown = draft.people.filter(
    (person) => isNewReference(person.ref) || personItems(person).length > 0,
  );
  const edges = edgeItems(draft);
  if (shown.length === 0 && edges.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p>{t('intake.empty')}</p>
        <Button onClick={onRestart}>{t('intake.restart')}</Button>
      </div>
    );
  }
  const ready = namesReady(draft, choices);
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        setLocked(true);
        setFailure(undefined);
        setPending(true);
        saveIntake(
          draft,
          choices,
          view,
          questions,
          {
            addPerson: (body) => writeCase(passkeys, routes.addCasePerson, body),
            answer: (body) => writeCase(passkeys, routes.answerCaseQuestions, body),
            relate: (body) => writeCase(passkeys, routes.addCaseRelationship, body),
          },
          progressRef.current,
        )
          .then(async (updated) => {
            queryClient.setQueryData(caseQuery.queryKey, { case: updated });
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: caseQuestionsQuery.queryKey }),
              queryClient.invalidateQueries({ queryKey: casePlaybackQuery.queryKey }),
            ]);
            await navigate({ to: '/family/questions' });
          })
          .catch((error: unknown) => {
            setFailure(caseFailure(error));
          })
          .finally(() => {
            setPending(false);
          });
      }}
    >
      <p className="text-muted">{t('intake.reviewLead')}</p>
      <fieldset disabled={locked || pending} className="flex flex-col gap-6">
        {shown.map((person) => {
          const choice = choices.people.get(person.ref);
          const items = personItems(person);
          const stored = storedAnswers(questions, person.ref);
          return (
            <section
              key={person.ref}
              aria-label={nameOf(person.ref)}
              className="flex flex-col gap-3 rounded-control border border-line p-3"
            >
              <h3 className="font-display text-lead">{nameOf(person.ref)}</h3>
              {choice !== undefined && (
                <NewPersonFields
                  choice={choice}
                  onChange={(next) => {
                    update({ people: new Map(choices.people).set(person.ref, next) });
                  }}
                />
              )}
              {choice?.keep !== false &&
                items.map(({ id, sentence }) => (
                  <CheckRow
                    key={id}
                    label={text(sentence)}
                    checked={!choices.dropped.has(id)}
                    onChange={(on) => {
                      const list = lists.find((name) =>
                        id.startsWith(`${listId(person.ref, name)}:`),
                      );
                      update({
                        dropped: toggled(choices.dropped, id, !on),
                        // A changed list needs confirming again.
                        whole:
                          list === undefined
                            ? choices.whole
                            : toggled(choices.whole, listId(person.ref, list), false),
                      });
                    }}
                  />
                ))}
              {choice?.keep !== false &&
                lists.map((list) => {
                  const id = listId(person.ref, list);
                  const kept = items.some(
                    (item) => item.id.startsWith(`${id}:`) && !choices.dropped.has(item.id),
                  );
                  if (!kept) return null;
                  const entries = wholeList(person, list, choices, stored.get(list)).map((entry) =>
                    list === 'citizenships'
                      ? labels.country(String(entry['country']))
                      : labels.language(String(entry['language'])),
                  );
                  return (
                    <div key={list} className="flex flex-col gap-1">
                      <CheckRow
                        label={t(`intake.whole.${list}`, {
                          name: nameOf(person.ref),
                          list: listFormat.format(entries),
                        })}
                        checked={choices.whole.has(id)}
                        onChange={(on) => {
                          update({ whole: toggled(choices.whole, id, on) });
                        }}
                      />
                      <p className="text-small text-muted">{t('intake.wholeHint')}</p>
                    </div>
                  );
                })}
            </section>
          );
        })}
        {edges.length > 0 && (
          <section
            aria-label={t('playback.relationships')}
            className="flex flex-col gap-3 rounded-control border border-line p-3"
          >
            <h3 className="font-display text-lead">{t('playback.relationships')}</h3>
            {edges.map(({ id, sentence }) => (
              <CheckRow
                key={id}
                label={text(sentence)}
                checked={!choices.dropped.has(id)}
                onChange={(on) => {
                  update({ dropped: toggled(choices.dropped, id, !on) });
                }}
              />
            ))}
          </section>
        )}
      </fieldset>
      <Button type="submit" disabled={pending || !ready} aria-busy={pending}>
        {locked ? t('questions.retry') : t('intake.save')}
      </Button>
      <p role="status" className={failure === undefined ? 'text-muted' : 'text-ink'}>
        {pending
          ? t('family.saving')
          : failure !== undefined
            ? t('intake.saveFailure', { reason: failure })
            : ready
              ? ''
              : t('intake.needNames')}
      </p>
      {!locked && (
        <button type="button" className={`${textLinkClass} self-start`} onClick={onRestart}>
          {t('intake.restart')}
        </button>
      )}
    </form>
  );
}

type Keep = 'keep' | 'drop';

/** Keeps a proposed new person, with their name and whether they are in the plan, or drops them. */
function NewPersonFields({
  choice,
  onChange,
}: {
  readonly choice: NewPerson;
  readonly onChange: (choice: NewPerson) => void;
}) {
  const { t } = useTranslation();
  const keeps: readonly Keep[] = ['keep', 'drop'];
  return (
    <div className="flex flex-col gap-3">
      <ChoiceGroup<Keep>
        legend={t('intake.choice.legend')}
        choices={keeps.map((value) => ({ value, label: t(`intake.choice.${value}`) }))}
        value={choice.keep ? 'keep' : 'drop'}
        onChange={(next) => {
          onChange({ ...choice, keep: next === 'keep' });
        }}
      />
      {choice.keep && (
        <>
          <TextField
            label={t('family.name')}
            hint={t('intake.nameHint')}
            {...nameInput}
            value={choice.displayName}
            onChange={(event) => {
              onChange({ ...choice, displayName: event.currentTarget.value });
            }}
          />
          <MembershipChoice
            value={choice.caseMember ? 'member' : 'relative'}
            onChange={(next) => {
              onChange({ ...choice, caseMember: next === 'member' });
            }}
          />
        </>
      )}
    </div>
  );
}
