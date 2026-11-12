import {
  maxCaseMembers,
  maxCasePeople,
  routes,
  type CaseAdmin,
  type CasePerson,
  type CaseRelationship,
  type CaseView,
} from '@arca/api-contract/client';
import { Button, ChoiceGroup, Icon, iconButtonClass, StatusChip, type IconName } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type SubmitEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { adminFailure, grantAdmin, removeAdmin, type AdminFailure } from '../admins.js';
import { caseAdminsQuery, caseQuery, invitesQuery, sessionQuery } from '../api.js';
import { caseFailure, handOverPerson, leaveCase, writeCase, type CaseFailure } from '../case.js';
import { newsOf, readSeen, seenOf, writeSeen } from '../family-news.js';
import {
  familyLayouts,
  readFamilyLayout,
  writeFamilyLayout,
  type FamilyLayout,
} from '../family-layout.js';
import { familyTree } from '../family-tree.js';
import { CheckRow } from '../forms/check-row.js';
import { nameInput } from '../forms/inputs.js';
import { MembershipChoice, type Membership } from '../forms/membership-choice.js';
import { TextField } from '../forms/text-field.js';
import { dangerLinkClass, textLinkClass } from '../forms/text-link.js';
import { Page } from '../page.js';
import { passkeys } from '../platform.js';

export const Route = createFileRoute('/family')({ component: Family });

/** The family area (spec 0007, R2): the case's people, who sees what, invites and leaving. */
function Family() {
  const { t } = useTranslation();
  const [layout, setLayout] = useState(readFamilyLayout);
  const session = useQuery(sessionQuery);
  const familyCase = useQuery({ ...caseQuery, enabled: session.data?.confirmed === true });
  if (session.isError) {
    return (
      <Page title={t('family.title')}>
        <p>{t('family.signIn')}</p>
        <Link to="/sign-in" className={textLinkClass}>
          {t('session.signIn')}
        </Link>
      </Page>
    );
  }
  if (!session.isSuccess) return <Page title={t('family.title')} />;
  if (!session.data.confirmed) {
    return (
      <Page title={t('family.title')}>
        <p>{t('session.unconfirmed')}</p>
      </Page>
    );
  }
  if (familyCase.isError) {
    return (
      <Page title={t('family.title')}>
        <p className="text-ink">{t('family.loadFailure')}</p>
        <Button
          disabled={familyCase.isFetching}
          aria-busy={familyCase.isFetching}
          onClick={() => void familyCase.refetch()}
        >
          {t('family.retry')}
        </Button>
      </Page>
    );
  }
  if (!familyCase.isSuccess) return <Page title={t('family.title')} />;
  const view = familyCase.data.case;
  return (
    <Page
      title={t('family.title')}
      lead={t(view === null ? 'family.startLead' : 'family.lead')}
      wide={view !== null}
      actions={
        view === null ? undefined : (
          <LayoutToggle
            layout={layout}
            onChange={(next) => {
              writeFamilyLayout(next);
              setLayout(next);
            }}
          />
        )
      }
    >
      {view === null ? (
        <StartCase />
      ) : (
        <FamilyCase
          view={view}
          accountId={session.data.accountId}
          admin={session.data.admin}
          layout={layout}
        />
      )}
    </Page>
  );
}

/**
 * One write at a time per form: it runs, puts the case it answers in the cache, and words a
 * refusal. `run` resolves to the new case, or null when the viewer is no longer in one.
 */
function useCaseWrite() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<CaseFailure>();
  const run = (write: () => Promise<CaseView | null>, then?: (view: CaseView | null) => void) => {
    setFailure(undefined);
    setPending(true);
    write()
      .then((updated) => {
        queryClient.setQueryData(caseQuery.queryKey, { case: updated });
        then?.(updated);
      })
      .catch((error: unknown) => {
        setFailure(caseFailure(error));
      })
      .finally(() => {
        setPending(false);
      });
  };
  return { pending, failure, run };
}

function WriteStatus({
  pending,
  failure,
  waiting = 'family.saving',
}: {
  readonly pending: boolean;
  readonly failure: CaseFailure | undefined;
  readonly waiting?: 'family.saving' | 'family.waiting';
}) {
  const { t } = useTranslation();
  return (
    <p role="status" className={failure === undefined && !pending ? 'text-muted' : 'text-ink'}>
      {pending
        ? t(waiting)
        : failure === undefined
          ? ''
          : t('family.failure', { reason: failure, max: maxCaseMembers, people: maxCasePeople })}
    </p>
  );
}

function StartCase() {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState('');
  const { pending, failure, run } = useCaseWrite();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        run(() => writeCase(passkeys, routes.createCase, { displayName: displayName.trim() }));
      }}
    >
      <TextField
        label={t('family.yourName')}
        hint={t('family.yourNameHint')}
        {...nameInput}
        autoComplete="name"
        value={displayName}
        onChange={(event) => {
          setDisplayName(event.currentTarget.value);
        }}
      />
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {t('family.start')}
      </Button>
      <WriteStatus pending={pending} failure={failure} />
    </form>
  );
}

/** Members who joined and shares that changed since this device last looked. */
function FamilyNews({ view, accountId }: { readonly view: CaseView; readonly accountId: string }) {
  const { t } = useTranslation();
  // A device that never looked at this case starts from what it sees now.
  const [seen, setSeen] = useState(() => {
    const stored = readSeen(accountId);
    if (stored?.caseId === view.caseId) return stored;
    const baseline = seenOf(view);
    writeSeen(accountId, baseline);
    return baseline;
  });
  const news = newsOf(view, seen);
  const lines = [
    ...news.joined.map((person) => ({
      key: `joined:${person.id}`,
      text: t('family.news.joined', { name: person.displayName }),
    })),
    ...news.granted.map(({ person, scope }) => ({
      key: `granted:${person.id}:${scope}`,
      text: t('family.news.granted', { name: person.displayName, scope }),
    })),
    ...news.revoked.map(({ person, scope }) => ({
      key: `revoked:${person.id}:${scope}`,
      text: t('family.news.revoked', { name: person.displayName, scope }),
    })),
  ];
  if (lines.length === 0) return null;
  return (
    <section
      aria-labelledby="family-news-title"
      className="flex flex-col gap-2 rounded-card border border-line bg-soft p-4"
    >
      <h3 id="family-news-title" className="font-medium">
        {t('family.news.title')}
      </h3>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {lines.map((line) => (
          <li key={line.key}>{line.text}</li>
        ))}
      </ul>
      {news.joined.length > 0 && <p className="text-small text-muted">{t('family.news.decide')}</p>}
      <button
        type="button"
        className={textLinkClass}
        onClick={() => {
          const current = seenOf(view);
          writeSeen(accountId, current);
          setSeen(current);
        }}
      >
        {t('family.news.done')}
      </button>
    </section>
  );
}

function FamilyCase({
  view,
  accountId,
  admin,
  layout,
}: {
  readonly view: CaseView;
  readonly accountId: string;
  readonly admin: boolean;
  readonly layout: FamilyLayout;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string>();
  const [adding, setAdding] = useState(false);
  /** The person just added, whose sharing the screen asks about first (R2). */
  const [justAdded, setJustAdded] = useState<string>();
  // Only an admin sees who is one, and only an admin may change it (ADR-0027).
  const admins = useQuery({ ...caseAdminsQuery, enabled: admin });
  const caseAdmins = admin ? admins.data?.admins : undefined;
  const names = new Map(view.people.map((person) => [person.id, person.displayName]));
  const relationLine = useRelationLine(view, names);
  const sharingLine = useSharingLine(view);
  // A person who left the case while open closes the panel.
  const chosen = view.people.find((person) => person.id === selected);
  // The list always shows someone beside it on a wide screen: the viewer, until they pick.
  const shown =
    chosen ?? (layout === 'list' ? view.people.find(({ id }) => id === view.me) : undefined);
  const picked = adding || chosen !== undefined;
  const panelOpen = adding || shown !== undefined;
  const select = (personId: string) => {
    setAdding(false);
    setSelected(personId);
  };
  // Closing the panel hands focus back to what opened it, so the place is not lost.
  const returnFocusRef = useRef<string>(undefined);
  useEffect(() => {
    if (returnFocusRef.current === undefined) return;
    document
      .querySelector<HTMLElement>(`[data-family-entry="${CSS.escape(returnFocusRef.current)}"]`)
      ?.focus();
    returnFocusRef.current = undefined;
  });
  const close = () => {
    returnFocusRef.current = adding ? addingKey : selected;
    setAdding(false);
    setSelected(undefined);
  };
  // A new layout starts with no one picked, so a phone shows the people again.
  const [laidOut, setLaidOut] = useState(layout);
  if (laidOut !== layout) {
    setLaidOut(layout);
    setJustAdded(undefined);
    setAdding(false);
    setSelected(undefined);
  }
  const entry = (person: CasePerson) => ({
    person,
    isMe: person.id === view.me,
    current: person.id === shown?.id && !adding,
    onSelect: () => {
      select(person.id);
    },
  });
  const columns =
    layout === 'list'
      ? 'lg:grid-cols-[20rem_minmax(0,1fr)]'
      : panelOpen
        ? 'lg:grid-cols-[minmax(0,1fr)_26rem]'
        : '';
  return (
    <>
      <FamilyNews view={view} accountId={accountId} />
      <nav aria-label={t('family.next')} className="grid gap-3 sm:grid-cols-3">
        {view.people.some((person) => person.keptByMe) && (
          <NextLink to="/family/questions" icon="documents" label={t('family.questions')} />
        )}
        <NextLink to="/family/intake" icon="ai" label={t('intake.open')} />
        <NextLink to="/family/results" icon="plan" label={t('results.open')} />
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-lead">
          {t('family.peopleCount', { count: view.people.length })}
        </h3>
        <Button
          variant="secondary"
          aria-expanded={adding}
          data-family-entry={addingKey}
          onClick={() => {
            setSelected(undefined);
            setAdding(true);
          }}
        >
          <Icon name="addPerson" />
          {t('family.add.title')}
        </Button>
      </div>
      <div className={`grid items-start gap-5 ${columns}`}>
        <div className={`min-w-0 ${picked ? 'max-lg:hidden' : ''}`}>
          {layout === 'tree' && <TreeView view={view} entry={entry} />}
          {layout === 'cards' && (
            <ul
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
              aria-label={t('family.peopleTitle')}
            >
              {view.people.map((person) => (
                <li key={person.id} className="flex">
                  <PersonCard
                    {...entry(person)}
                    relations={relationLine(person)}
                    admin={
                      caseAdmins?.some(({ accountId: id }) => id === person.accountId) === true
                    }
                    sharing={sharingLine(person)}
                  />
                </li>
              ))}
            </ul>
          )}
          {layout === 'list' && (
            <ul
              className="flex flex-col gap-1 rounded-card border border-line bg-surface p-2 shadow-card"
              aria-label={t('family.peopleTitle')}
            >
              {view.people.map((person) => (
                <li key={person.id}>
                  <PersonRow {...entry(person)} />
                </li>
              ))}
            </ul>
          )}
        </div>
        {panelOpen && (
          <div className={`min-w-0 ${picked ? '' : 'max-lg:hidden'}`}>
            <Panel
              title={
                adding || shown === undefined
                  ? t('family.add.title')
                  : shown.id === view.me
                    ? t('family.me', { name: shown.displayName })
                    : shown.displayName
              }
              focusKey={adding ? addingKey : (shown?.id ?? '')}
              focus={picked}
              onBack={picked ? close : undefined}
              onClose={layout === 'list' && !adding ? undefined : close}
            >
              {adding || shown === undefined ? (
                <AddPerson
                  view={view}
                  onAdded={(personId) => {
                    setJustAdded(personId);
                    select(personId);
                  }}
                />
              ) : (
                <PersonDetails
                  key={shown.id}
                  person={shown}
                  view={view}
                  names={names}
                  askSharing={shown.id === justAdded}
                  admins={caseAdmins}
                />
              )}
            </Panel>
          </div>
        )}
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Invites />
        <Leave />
      </div>
    </>
  );
}

/** The panel's focus key while it shows the form to add a person. */
const addingKey = 'adding';

/** A shortcut to the next steps of the case. */
function NextLink({
  to,
  icon,
  label,
}: {
  readonly to: '/family/questions' | '/family/intake' | '/family/results';
  readonly icon: IconName;
  readonly label: string;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-touch items-center gap-3 rounded-card border border-line bg-surface p-4 font-medium shadow-card hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-warn-bg text-warn-ink">
        <Icon name={icon} />
      </span>
      {label}
    </Link>
  );
}

/** Switches between the tree, the cards and the list (the page's top right). */
function LayoutToggle({
  layout,
  onChange,
}: {
  readonly layout: FamilyLayout;
  readonly onChange: (layout: FamilyLayout) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t('family.layout.label')}
      className="inline-flex shrink-0 gap-0.5 rounded-control border border-line bg-surface p-0.5"
    >
      {familyLayouts.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={layout === option}
          aria-label={t(`family.layout.${option}`)}
          title={t(`family.layout.${option}`)}
          className={`${iconButtonClass} ${layout === option ? 'bg-soft text-ink' : 'text-muted hover:text-ink'}`}
          onClick={() => {
            onChange(option);
          }}
        >
          <Icon name={option} />
        </button>
      ))}
    </div>
  );
}

interface EntryProps {
  readonly person: CasePerson;
  readonly isMe: boolean;
  /** The person the panel shows. */
  readonly current: boolean;
  readonly onSelect: () => void;
}

const entryClass =
  'text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** A person's initials on a disc tinted by where they stand in the case. */
function Avatar({
  person,
  isMe,
  large = false,
}: {
  readonly person: CasePerson;
  readonly isMe: boolean;
  readonly large?: boolean;
}) {
  const tone = !person.caseMember
    ? 'bg-soft text-muted'
    : isMe
      ? 'bg-warn-bg text-warn-ink ring-1 ring-accent'
      : person.accountId === null
        ? 'bg-warn-bg text-warn-ink'
        : 'bg-ok-bg text-ok-ink';
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${tone} ${large ? 'size-14 text-lead' : 'size-10 text-small'}`}
    >
      {initials(person.displayName)}
    </span>
  );
}

/** How a person shows in a short line: who keeps them or whether they have an account. */
function useStanding() {
  const { t } = useTranslation();
  return (person: CasePerson, isMe: boolean) =>
    person.keptByMe && !isMe && person.accountId === null
      ? t('family.kept')
      : t(person.accountId === null ? 'family.noAccount' : 'family.hasAccount');
}

function PersonName({
  id,
  person,
  isMe,
}: {
  readonly id: string;
  readonly person: CasePerson;
  readonly isMe: boolean;
}) {
  const { t } = useTranslation();
  return (
    <span id={id} className="font-medium break-words">
      {isMe ? t('family.me', { name: person.displayName }) : person.displayName}
    </span>
  );
}

function PersonCard({
  person,
  isMe,
  current,
  onSelect,
  relations,
  admin,
  sharing,
}: EntryProps & {
  readonly relations: string;
  readonly admin: boolean;
  readonly sharing: string;
}) {
  const { t } = useTranslation();
  const nameId = useId();
  const relationsId = useId();
  const chipsId = useId();
  const sharingId = useId();
  return (
    <button
      type="button"
      aria-labelledby={nameId}
      aria-describedby={`${relations === '' ? '' : `${relationsId} `}${chipsId} ${sharingId}`}
      aria-current={current}
      data-family-entry={person.id}
      onClick={onSelect}
      className={`${entryClass} flex w-full flex-col gap-3 rounded-card border bg-surface p-4 shadow-card hover:bg-soft ${current ? 'border-accent' : 'border-line'}`}
    >
      <span className="flex items-center gap-3">
        <Avatar person={person} isMe={isMe} />
        <span className="flex min-w-0 flex-col">
          <PersonName id={nameId} person={person} isMe={isMe} />
          {relations !== '' && (
            <span id={relationsId} className="text-small text-muted">
              {relations}
            </span>
          )}
        </span>
      </span>
      <span id={chipsId} className="flex flex-wrap gap-1.5">
        <StatusChip
          tone={person.caseMember ? 'ok' : 'unknown'}
          label={t(person.caseMember ? 'family.member' : 'family.relative')}
        />
        <StatusChip
          tone={person.accountId === null ? 'unknown' : 'ok'}
          label={t(person.accountId === null ? 'family.noAccount' : 'family.hasAccount')}
        />
        {admin && <StatusChip tone="ok" label={t('family.admin.badge')} />}
      </span>
      <span id={sharingId} className="border-t border-line pt-2 text-small text-muted">
        {sharing}
      </span>
    </button>
  );
}

function PersonRow({ person, isMe, current, onSelect }: EntryProps) {
  const { t } = useTranslation();
  const standing = useStanding();
  const nameId = useId();
  const detailsId = useId();
  return (
    <button
      type="button"
      aria-labelledby={nameId}
      aria-describedby={detailsId}
      aria-current={current}
      data-family-entry={person.id}
      onClick={onSelect}
      className={`${entryClass} flex min-h-touch w-full items-center gap-3 rounded-control p-2 hover:bg-soft ${current ? 'bg-soft' : ''}`}
    >
      <Avatar person={person} isMe={isMe} />
      <span className="flex min-w-0 flex-1 flex-col">
        <PersonName id={nameId} person={person} isMe={isMe} />
        <span id={detailsId} className="text-small text-muted">
          {t(person.caseMember ? 'family.member' : 'family.relative')} · {standing(person, isMe)}
        </span>
      </span>
      <Icon name="chevron" size={16} />
    </button>
  );
}

function PersonTile({ person, isMe, current, onSelect }: EntryProps) {
  const standing = useStanding();
  const nameId = useId();
  const detailsId = useId();
  return (
    <button
      type="button"
      aria-labelledby={nameId}
      aria-describedby={detailsId}
      aria-current={current}
      data-family-entry={person.id}
      onClick={onSelect}
      className={`${entryClass} flex min-h-touch w-36 items-center gap-2 rounded-control border bg-surface p-2 shadow-card hover:bg-soft sm:w-52 sm:gap-3 sm:p-3 ${current ? 'border-accent' : 'border-line'}`}
    >
      <Avatar person={person} isMe={isMe} />
      <span className="flex min-w-0 flex-col">
        <PersonName id={nameId} person={person} isMe={isMe} />
        <span id={detailsId} className="text-caption text-muted">
          {standing(person, isMe)}
        </span>
      </span>
    </button>
  );
}

/** The planning's generations, couples side by side, with the people outside it apart. */
function TreeView({
  view,
  entry,
}: {
  readonly view: CaseView;
  readonly entry: (person: CasePerson) => EntryProps;
}) {
  const { t } = useTranslation();
  const tree = familyTree(view);
  const people = new Map(view.people.map((person) => [person.id, person]));
  const tile = (personId: string) => {
    const person = people.get(personId);
    return person === undefined ? null : <PersonTile {...entry(person)} />;
  };
  const membersId = useId();
  const outsideId = useId();
  return (
    <div className="flex flex-col gap-4">
      {tree.generations.length > 0 && (
        <section
          aria-labelledby={membersId}
          className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-card sm:p-6"
        >
          <h4 id={membersId} className="font-medium">
            {t('family.tree.members')}
          </h4>
          <div className="flex flex-col items-center">
            {tree.generations.map((row, level) => (
              <Fragment key={row.map(({ people: ids }) => ids.join()).join()}>
                {level > 0 && <span aria-hidden="true" className="h-6 w-0.5 bg-second" />}
                <ul className="flex flex-wrap justify-center gap-3">
                  {row.map((unit) => (
                    <li key={unit.people.join()} className="flex flex-col items-center sm:flex-row">
                      {tile(unit.people[0] ?? '')}
                      {unit.bond !== undefined && (
                        <>
                          <span className="flex flex-col items-center px-1 text-caption text-muted">
                            {t(`family.tree.${unit.bond}`)}
                            <span
                              aria-hidden="true"
                              className="order-first h-3 w-0.5 bg-second sm:order-none sm:h-0.5 sm:w-12"
                            />
                          </span>
                          {tile(unit.people[1] ?? '')}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </Fragment>
            ))}
          </div>
        </section>
      )}
      {tree.outside.length > 0 && (
        <section
          aria-labelledby={outsideId}
          className="flex flex-col gap-4 rounded-card border border-line bg-soft p-4 sm:p-6"
        >
          <h4 id={outsideId} className="font-medium">
            {t('family.tree.outside')}
          </h4>
          <ul className="flex flex-wrap gap-3">
            {tree.outside.map((personId) => (
              <li key={personId}>{tile(personId)}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * The side panel, or the whole screen on a phone: one person, or the form to add one. Its heading
 * takes focus when what it shows changes, so a keyboard or screen reader lands on it.
 */
function Panel({
  title,
  focusKey,
  focus,
  onBack,
  onClose,
  children,
}: {
  readonly title: string;
  readonly focusKey: string;
  /** False while the list shows the viewer before anyone was picked: focus stays on the page. */
  readonly focus: boolean;
  readonly onBack: (() => void) | undefined;
  readonly onClose: (() => void) | undefined;
  readonly children: ReactNode;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) headingRef.current?.focus();
  }, [focusKey, focus]);
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-card sm:p-6"
    >
      {onBack !== undefined && (
        <button type="button" className={`${textLinkClass} gap-1 lg:hidden`} onClick={onBack}>
          <Icon name="back" size={16} />
          {t('family.back')}
        </button>
      )}
      <div className="flex items-start justify-between gap-3">
        <h3
          id={titleId}
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-title break-words outline-none"
        >
          {title}
        </h3>
        {onClose !== undefined && (
          <button
            type="button"
            aria-label={t('family.close')}
            className={`${iconButtonClass} text-muted hover:text-ink max-lg:hidden`}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/** Who the person is to the others, from the relationships the viewer sees. */
function relationsOf(
  person: CasePerson,
  relationships: readonly CaseRelationship[],
  names: ReadonlyMap<string, string>,
) {
  return relationships.flatMap(({ relationship }) => {
    const other =
      relationship.from === person.id
        ? relationship.to
        : relationship.to === person.id
          ? relationship.from
          : undefined;
    if (other === undefined) return [];
    const role =
      relationship.kind === 'parent'
        ? relationship.from === person.id
          ? ('parentOf' as const)
          : ('childOf' as const)
        : relationship.kind;
    return [{ role, name: names.get(other) ?? '' }];
  });
}

/** The person's relationships as one short line, such as "Filha ou filho de Ana". */
function useRelationLine(view: CaseView, names: ReadonlyMap<string, string>) {
  const { t } = useTranslation();
  return (person: CasePerson) =>
    relationsOf(person, view.relationships, names)
      .map(({ role, name }) => t(`family.relation.${role}`, { name }))
      .join(' · ');
}

/** Who sees the person's data, or what the viewer sees of someone another member keeps. */
function useSharingLine(view: CaseView) {
  const { t } = useTranslation();
  const memberNames = (accounts: readonly string[]) =>
    accounts
      .map((account) => view.people.find((other) => other.accountId === account)?.displayName)
      .filter((name) => name !== undefined)
      .join(', ');
  return (person: CasePerson) =>
    person.shares === null
      ? t('family.sharedWithMe', {
          what: person.sharedWithMe.length === 2 ? 'both' : (person.sharedWithMe[0] ?? 'none'),
        })
      : t('family.whoSees', {
          profile: memberNames(person.shares.profile) || t('family.nobody'),
          finances: memberNames(person.shares.finances) || t('family.nobody'),
        });
}

/** The first letters of the first and last words of a name. */
function initials(name: string) {
  const words = name.trim().split(/\s+/u);
  const graphemes = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' });
  const first = (word: string | undefined) => {
    for (const { segment } of graphemes.segment(word ?? '')) return segment;
    return '';
  };
  const letters = first(words[0]) + (words.length > 1 ? first(words.at(-1)) : '');
  return letters.toLocaleUpperCase('pt-BR');
}

function PersonDetails({
  person,
  view,
  names,
  askSharing,
  admins,
}: {
  readonly person: CasePerson;
  readonly view: CaseView;
  readonly names: ReadonlyMap<string, string>;
  readonly askSharing: boolean;
  /** The case's admins, known only to an admin. */
  readonly admins: readonly CaseAdmin[] | undefined;
}) {
  const { t } = useTranslation();
  const isMe = person.id === view.me;
  const role = admins?.find(({ accountId }) => accountId === person.accountId);
  const sharingLine = useSharingLine(view);
  const others = view.people.filter(
    (other) => other.accountId !== null && other.id !== view.me && other.id !== person.id,
  );
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Avatar person={person} isMe={isMe} large />
        <div className="flex flex-wrap gap-1.5">
          <StatusChip
            tone={person.caseMember ? 'ok' : 'unknown'}
            label={t(person.caseMember ? 'family.member' : 'family.relative')}
          />
          <StatusChip
            tone={person.accountId === null ? 'unknown' : 'ok'}
            label={t(person.accountId === null ? 'family.noAccount' : 'family.hasAccount')}
          />
          {role !== undefined && <StatusChip tone="ok" label={t('family.admin.badge')} />}
        </div>
      </div>
      <p className="text-small text-muted">{sharingLine(person)}</p>
      {person.keptByMe && (
        <KeptActions person={person} isMe={isMe} others={others} askSharing={askSharing} />
      )}
      {admins !== undefined && person.accountId !== null && !isMe && (
        <AdminRole name={person.displayName} accountId={person.accountId} role={role} />
      )}
      <Relationships person={person} view={view} names={names} />
    </div>
  );
}

/**
 * Gives or takes away another member's admin role (ADR-0027): giving it asks for a passkey, taking
 * it away does not, and an account the owner list names keeps it.
 */
function AdminRole({
  name,
  accountId,
  role,
}: {
  readonly name: string;
  readonly accountId: string;
  readonly role: CaseAdmin | undefined;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<AdminFailure>();
  const run = (change: () => Promise<void>) => {
    setFailure(undefined);
    setPending(true);
    change()
      .catch((error: unknown) => {
        setFailure(adminFailure(error));
      })
      .finally(() => {
        setPending(false);
        void queryClient.invalidateQueries({ queryKey: caseAdminsQuery.queryKey });
      });
  };
  if (role?.onOwnerList === true) return null;
  return (
    <div className="flex flex-col gap-2">
      {role === undefined ? (
        <Confirmed
          label={t('family.admin.grant')}
          warning={t('family.admin.grantConfirm', { name })}
          confirm={t('family.admin.grantYes')}
          disabled={pending}
          tone="plain"
          onConfirm={() => {
            run(() => grantAdmin(passkeys, accountId));
          }}
        />
      ) : (
        <Confirmed
          label={t('family.admin.remove')}
          warning={t('family.admin.removeConfirm', { name })}
          confirm={t('family.admin.removeYes')}
          disabled={pending}
          onConfirm={() => {
            run(() => removeAdmin(accountId));
          }}
        />
      )}
      <p role="status" className={failure === undefined && !pending ? 'text-muted' : 'text-ink'}>
        {pending
          ? t(role === undefined ? 'family.waiting' : 'family.saving')
          : failure === undefined
            ? ''
            : t('family.admin.failure', { reason: failure })}
      </p>
    </div>
  );
}

type KeptPanel = 'sharing' | 'edit' | 'handOver';

/** What the keeper may do with a person: sharing, renaming, handing over, inviting, removing. */
function KeptActions({
  person,
  isMe,
  others,
  askSharing,
}: {
  readonly person: CasePerson;
  readonly isMe: boolean;
  readonly others: readonly CasePerson[];
  readonly askSharing: boolean;
}) {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<KeptPanel | undefined>(
    askSharing && others.length > 0 ? 'sharing' : undefined,
  );
  const remove = useCaseWrite();
  const withoutAccount = person.accountId === null;
  const toggle = (next: KeptPanel) => {
    setPanel(panel === next ? undefined : next);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-4">
        {others.length > 0 && (
          <button
            type="button"
            className={textLinkClass}
            aria-expanded={panel === 'sharing'}
            onClick={() => {
              toggle('sharing');
            }}
          >
            {t('family.actions.sharing')}
          </button>
        )}
        <button
          type="button"
          className={textLinkClass}
          aria-expanded={panel === 'edit'}
          onClick={() => {
            toggle('edit');
          }}
        >
          {t('family.actions.edit')}
        </button>
        {withoutAccount && others.length > 0 && (
          <button
            type="button"
            className={textLinkClass}
            aria-expanded={panel === 'handOver'}
            onClick={() => {
              toggle('handOver');
            }}
          >
            {t('family.actions.handOver')}
          </button>
        )}
        {withoutAccount && (
          <Link to="/invites" className={textLinkClass}>
            {t('family.actions.invite')}
          </Link>
        )}
      </div>
      {withoutAccount && !isMe && (
        <Confirmed
          label={t('family.actions.remove')}
          warning={t('family.removeConfirm', { name: person.displayName })}
          confirm={t('family.removeYes')}
          disabled={remove.pending}
          onConfirm={() => {
            remove.run(() => writeCase(passkeys, routes.removeCasePerson, { personId: person.id }));
          }}
        />
      )}
      <WriteStatus pending={remove.pending} failure={remove.failure} />
      {panel === 'sharing' && (
        <Sharing
          person={person}
          others={others}
          first={askSharing}
          onDone={() => {
            setPanel(undefined);
          }}
        />
      )}
      {panel === 'edit' && (
        <EditPerson
          person={person}
          isMe={isMe}
          onDone={() => {
            setPanel(undefined);
          }}
        />
      )}
      {panel === 'handOver' && <HandOver person={person} others={others} />}
    </div>
  );
}

/** The members who see this person's profile and finances; none checked until the keeper picks. */
function Sharing({
  person,
  others,
  first,
  onDone,
}: {
  readonly person: CasePerson;
  readonly others: readonly CasePerson[];
  readonly first: boolean;
  readonly onDone: () => void;
}) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState(() => new Set(person.shares?.profile));
  const [finances, setFinances] = useState(() => new Set(person.shares?.finances));
  const { pending, failure, run } = useCaseWrite();
  return (
    <form
      className="flex flex-col gap-3 rounded-control border border-line p-3"
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        run(
          () =>
            writeCase(passkeys, routes.replaceCaseShares, {
              personId: person.id,
              profile: [...profile],
              finances: [...finances],
            }),
          onDone,
        );
      }}
    >
      <p className="font-medium">
        {t(first ? 'family.sharing.firstTitle' : 'family.sharing.title', {
          name: person.displayName,
        })}
      </p>
      <p className="text-small text-muted">{t('family.sharing.lead')}</p>
      <Checks
        legend={t('family.sharing.profile')}
        people={others}
        checked={profile}
        onChange={setProfile}
      />
      <Checks
        legend={t('family.sharing.finances')}
        people={others}
        checked={finances}
        onChange={setFinances}
      />
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {t('family.sharing.save')}
      </Button>
      <WriteStatus pending={pending} failure={failure} />
    </form>
  );
}

function Checks({
  legend,
  people,
  checked,
  onChange,
}: {
  readonly legend: string;
  readonly people: readonly CasePerson[];
  readonly checked: ReadonlySet<string>;
  readonly onChange: (next: Set<string>) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-medium">{legend}</legend>
      {people.flatMap((other) =>
        other.accountId === null
          ? []
          : [
              <CheckRow
                key={other.id}
                label={other.displayName}
                checked={checked.has(other.accountId)}
                onChange={(on) => {
                  const next = new Set(checked);
                  if (other.accountId !== null) {
                    if (on) next.add(other.accountId);
                    else next.delete(other.accountId);
                  }
                  onChange(next);
                }}
              />,
            ],
      )}
    </fieldset>
  );
}

function EditPerson({
  person,
  isMe,
  onDone,
}: {
  readonly person: CasePerson;
  readonly isMe: boolean;
  readonly onDone: () => void;
}) {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState(person.displayName);
  const [membership, setMembership] = useState<Membership>(
    person.caseMember ? 'member' : 'relative',
  );
  const { pending, failure, run } = useCaseWrite();
  return (
    <form
      className="flex flex-col gap-3 rounded-control border border-line p-3"
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        run(
          () =>
            writeCase(passkeys, routes.updateCasePerson, {
              personId: person.id,
              displayName: displayName.trim(),
              caseMember: membership === 'member',
            }),
          onDone,
        );
      }}
    >
      <TextField
        label={t('family.name')}
        {...nameInput}
        value={displayName}
        onChange={(event) => {
          setDisplayName(event.currentTarget.value);
        }}
      />
      {person.accountId === null && !isMe && (
        <MembershipChoice value={membership} onChange={setMembership} />
      )}
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {t('family.save')}
      </Button>
      <WriteStatus pending={pending} failure={failure} />
    </form>
  );
}

/** Another member keeps the person from now on, after a step-up; the shares go (R2). */
function HandOver({
  person,
  others,
}: {
  readonly person: CasePerson;
  readonly others: readonly CasePerson[];
}) {
  const { t } = useTranslation();
  const members = others.filter((other) => other.accountId !== null);
  const [picked, setPicked] = useState(members[0]?.accountId ?? '');
  // A member who left while the panel was open is no longer a choice; the viewer picks again.
  const chosen = members.some(({ accountId }) => accountId === picked) ? picked : '';
  const { pending, failure, run } = useCaseWrite();
  return (
    <form
      className="flex flex-col gap-3 rounded-control border border-line p-3"
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        run(() => handOverPerson(passkeys, person.id, chosen));
      }}
    >
      <ChoiceGroup
        legend={t('family.handOver.legend', { name: person.displayName })}
        description={t('family.handOver.hint')}
        choices={members.flatMap((other) =>
          other.accountId === null ? [] : [{ value: other.accountId, label: other.displayName }],
        )}
        value={chosen}
        onChange={setPicked}
      />
      <Button type="submit" disabled={pending || chosen === ''} aria-busy={pending}>
        {t('family.handOver.submit')}
      </Button>
      <WriteStatus pending={pending} failure={failure} waiting="family.waiting" />
    </form>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card sm:p-6"
    >
      <h3 id={titleId} className="font-display text-lead">
        {title}
      </h3>
      {children}
    </section>
  );
}

function AddPerson({
  view,
  onAdded,
}: {
  readonly view: CaseView;
  readonly onAdded: (personId: string) => void;
}) {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState('');
  const [membership, setMembership] = useState<Membership>('member');
  const { pending, failure, run } = useCaseWrite();
  const known = new Set(view.people.map(({ id }) => id));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        run(
          () =>
            writeCase(passkeys, routes.addCasePerson, {
              displayName: displayName.trim(),
              caseMember: membership === 'member',
            }),
          (updated) => {
            setDisplayName('');
            const added = updated?.people.find((person) => !known.has(person.id));
            if (added !== undefined) onAdded(added.id);
          },
        );
      }}
    >
      <p className="text-small text-muted">{t('family.add.lead')}</p>
      <TextField
        label={t('family.name')}
        {...nameInput}
        value={displayName}
        onChange={(event) => {
          setDisplayName(event.currentTarget.value);
        }}
      />
      <MembershipChoice value={membership} onChange={setMembership} />
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {t('family.add.submit')}
      </Button>
      <WriteStatus pending={pending} failure={failure} />
    </form>
  );
}

/** A relationship as the panel offers it: seen from the person the panel shows. */
type RelationChoice = 'parentOf' | 'childOf' | 'spouse' | 'partner';

/** The relationships in the order they are offered; the record keeps every choice listed. */
const relationOffered: Readonly<Record<RelationChoice, true>> = {
  parentOf: true,
  childOf: true,
  spouse: true,
  partner: true,
};
const relationChoices = Object.keys(relationOffered) as RelationChoice[];

/** The edge a choice stores: a child's parent is the edge's `from`. */
function edgeOf(choice: RelationChoice, person: string, other: string) {
  return choice === 'childOf'
    ? { kind: 'parent' as const, from: other, to: person }
    : { kind: choice === 'parentOf' ? ('parent' as const) : choice, from: person, to: other };
}

/** The person's relationships, and adding one where the viewer keeps either end. */
function Relationships({
  person,
  view,
  names,
}: {
  readonly person: CasePerson;
  readonly view: CaseView;
  readonly names: ReadonlyMap<string, string>;
}) {
  const { t } = useTranslation();
  const kept = new Set(view.people.flatMap((other) => (other.keptByMe ? [other.id] : [])));
  const [choice, setChoice] = useState<RelationChoice>('parentOf');
  const [pickedOther, setPickedOther] = useState('');
  // A pick that left the case is no pick at all.
  const other = view.people.some(({ id }) => id === pickedOther) ? pickedOther : '';
  // The API takes a relationship where the viewer keeps either end.
  const ready = other !== '' && (kept.has(person.id) || kept.has(other));
  const add = useCaseWrite();
  const remove = useCaseWrite();
  const select =
    'min-h-touch rounded-control border border-line bg-surface px-3 text-body text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
  const kindId = useId();
  const otherId = useId();
  const titleId = useId();
  const own = view.relationships.filter(
    ({ relationship }) => relationship.from === person.id || relationship.to === person.id,
  );
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3 border-t border-line pt-4">
      <h4 id={titleId} className="font-medium">
        {t('family.relationships.title')}
      </h4>
      {own.length === 0 ? (
        <p className="text-small text-muted">{t('family.relationships.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {own.map(({ id, editable, relationship }) => (
            <li key={id} className="flex flex-wrap items-center justify-between gap-x-3">
              <span>
                {t(`family.relationships.${relationship.kind}`, {
                  from: names.get(relationship.from) ?? '',
                  to: names.get(relationship.to) ?? '',
                })}
              </span>
              {editable && (
                <button
                  type="button"
                  className={dangerLinkClass}
                  disabled={remove.pending}
                  onClick={() => {
                    remove.run(() =>
                      writeCase(passkeys, routes.removeCaseRelationship, { relationshipId: id }),
                    );
                  }}
                >
                  {t('family.relationships.remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <WriteStatus pending={remove.pending} failure={remove.failure} />
      {view.people.length > 1 && kept.size > 0 && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            add.run(
              () =>
                writeCase(passkeys, routes.addCaseRelationship, {
                  ...edgeOf(choice, person.id, other),
                  details: {},
                }),
              () => {
                setPickedOther('');
              },
            );
          }}
        >
          <p className="font-medium">
            {t('family.relationships.addTitle', { name: person.displayName })}
          </p>
          <label htmlFor={kindId} className="font-medium">
            {t('family.relationships.kind')}
          </label>
          <select
            id={kindId}
            className={select}
            value={choice}
            onChange={(event) => {
              setChoice(event.currentTarget.value as RelationChoice);
            }}
          >
            {relationChoices.map((option) => (
              <option key={option} value={option}>
                {t(`family.relationships.choice.${option}`, { name: person.displayName })}
              </option>
            ))}
          </select>
          <label htmlFor={otherId} className="font-medium">
            {t('family.relationships.to')}
          </label>
          <select
            id={otherId}
            className={select}
            required
            value={other}
            onChange={(event) => {
              setPickedOther(event.currentTarget.value);
            }}
          >
            <option value="">{t('family.relationships.pick')}</option>
            {view.people
              .filter(({ id }) => id !== person.id)
              .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.displayName}
                </option>
              ))}
          </select>
          {other !== '' && !ready && (
            <p className="text-small text-muted">{t('family.relationships.notKept')}</p>
          )}
          <Button type="submit" disabled={add.pending || !ready} aria-busy={add.pending}>
            {t('family.relationships.add')}
          </Button>
          <WriteStatus pending={add.pending} failure={add.failure} />
        </form>
      )}
    </section>
  );
}

/** The viewer's invites and where each stands, so a relative's account can be followed. */
function Invites() {
  const { t } = useTranslation();
  const invites = useQuery(invitesQuery);
  const familyCase = useQuery(caseQuery);
  const inCase = new Set(
    familyCase.data?.case?.people.flatMap((person) =>
      person.accountId === null ? [] : [person.accountId],
    ),
  );
  return (
    <Section title={t('family.invites.title')}>
      <p className="text-small text-muted">{t('family.invites.lead')}</p>
      {invites.isSuccess && invites.data.invites.length > 0 && (
        <ul className="flex flex-col gap-2">
          {invites.data.invites.map((invite) => (
            <li key={invite.id} className="flex flex-col">
              <span className="break-all">{invite.email}</span>
              <span className="text-small text-muted">
                {t('family.invites.status', {
                  status:
                    invite.accountId !== null && inCase.has(invite.accountId)
                      ? 'member'
                      : invite.status,
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/invites" className={textLinkClass}>
        {t('family.invites.link')}
      </Link>
    </Section>
  );
}

/** Leaving takes every person the viewer keeps out of the case, after a step-up (R2). */
function Leave() {
  const { t } = useTranslation();
  const { pending, failure, run } = useCaseWrite();
  return (
    <Section title={t('family.leave.title')}>
      <p className="text-small text-muted">{t('family.leave.lead')}</p>
      <Confirmed
        label={t('family.leave.submit')}
        warning={t('family.leave.confirm')}
        confirm={t('family.leave.yes')}
        disabled={pending}
        onConfirm={() => {
          run(() => leaveCase(passkeys).then(() => null));
        }}
      />
      <WriteStatus pending={pending} failure={failure} waiting="family.waiting" />
    </Section>
  );
}

/**
 * An action that asks once more, in the page, before it runs; destructive unless `tone` is plain.
 */
function Confirmed({
  label,
  warning,
  confirm,
  disabled,
  onConfirm,
  tone = 'danger',
}: {
  readonly label: string;
  readonly warning: string;
  readonly confirm: string;
  readonly disabled: boolean;
  readonly onConfirm: () => void;
  readonly tone?: 'danger' | 'plain';
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const actionClass = tone === 'danger' ? dangerLinkClass : textLinkClass;
  if (!asking) {
    return (
      <button
        type="button"
        className={actionClass}
        disabled={disabled}
        onClick={() => {
          setAsking(true);
        }}
      >
        {label}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-control border border-line p-3">
      <p className="text-ink">{warning}</p>
      <div className="flex flex-wrap gap-x-4">
        <button
          type="button"
          className={actionClass}
          disabled={disabled}
          onClick={() => {
            setAsking(false);
            onConfirm();
          }}
        >
          {confirm}
        </button>
        <button
          type="button"
          className={textLinkClass}
          onClick={() => {
            setAsking(false);
          }}
        >
          {t('family.confirmNo')}
        </button>
      </div>
    </div>
  );
}
