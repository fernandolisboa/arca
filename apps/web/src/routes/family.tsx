import {
  maxCaseMembers,
  maxCasePeople,
  routes,
  type CasePerson,
  type CaseRelationship,
  type CaseView,
} from '@arca/api-contract/client';
import { Button, ChoiceGroup, StatusChip } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useId, useState, type ReactNode, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { caseQuery, invitesQuery, sessionQuery } from '../api.js';
import { caseFailure, handOverPerson, leaveCase, writeCase, type CaseFailure } from '../case.js';
import { newsOf, readSeen, seenOf, writeSeen } from '../family-news.js';
import { nameInput } from '../forms/inputs.js';
import { TextField } from '../forms/text-field.js';
import { dangerLinkClass, textLinkClass } from '../forms/text-link.js';
import { Page } from '../page.js';
import { passkeys } from '../platform.js';

export const Route = createFileRoute('/family')({ component: Family });

/** The family area (spec 0007, R2): the case's people, who sees what, invites and leaving. */
function Family() {
  const { t } = useTranslation();
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
    <Page title={t('family.title')} lead={t(view === null ? 'family.startLead' : 'family.lead')}>
      {view === null ? (
        <StartCase />
      ) : (
        <FamilyCase view={view} accountId={session.data.accountId} />
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

function FamilyCase({ view, accountId }: { readonly view: CaseView; readonly accountId: string }) {
  const { t } = useTranslation();
  /** The person just added, whose sharing the screen asks about first (R2). */
  const [justAdded, setJustAdded] = useState<string>();
  const names = new Map(view.people.map((person) => [person.id, person.displayName]));
  return (
    <>
      <FamilyNews view={view} accountId={accountId} />
      {view.people.some((person) => person.keptByMe) && (
        <Link to="/family/questions" className={textLinkClass}>
          {t('family.questions')}
        </Link>
      )}
      <ul className="flex flex-col gap-3" aria-label={t('family.peopleTitle')}>
        {view.people.map((person) => (
          <PersonCard
            key={person.id}
            person={person}
            view={view}
            names={names}
            askSharing={person.id === justAdded}
          />
        ))}
      </ul>
      <AddPerson
        onAdded={(personId) => {
          setJustAdded(personId);
        }}
        view={view}
      />
      <Relationships view={view} names={names} />
      <Invites />
      <Leave />
    </>
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

function PersonCard({
  person,
  view,
  names,
  askSharing,
}: {
  readonly person: CasePerson;
  readonly view: CaseView;
  readonly names: ReadonlyMap<string, string>;
  readonly askSharing: boolean;
}) {
  const { t } = useTranslation();
  const isMe = person.id === view.me;
  const relations = relationsOf(person, view.relationships, names).map(({ role, name }) =>
    t(`family.relation.${role}`, { name }),
  );
  const others = view.people.filter(
    (other) => other.accountId !== null && other.id !== view.me && other.id !== person.id,
  );
  const memberNames = (accounts: readonly string[]) =>
    accounts
      .map((account) => view.people.find((other) => other.accountId === account)?.displayName)
      .filter((name) => name !== undefined)
      .join(', ');
  return (
    <li className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium break-words">
          {isMe ? t('family.me', { name: person.displayName }) : person.displayName}
        </p>
        <StatusChip
          tone={person.caseMember ? 'ok' : 'unknown'}
          label={t(person.caseMember ? 'family.member' : 'family.relative')}
        />
        <StatusChip
          tone={person.accountId === null ? 'unknown' : 'ok'}
          label={t(person.accountId === null ? 'family.noAccount' : 'family.hasAccount')}
        />
      </div>
      {relations.length > 0 && <p className="text-small text-muted">{relations.join(' · ')}</p>}
      {person.shares === null ? (
        <p className="text-small text-muted">
          {t('family.sharedWithMe', {
            what: person.sharedWithMe.length === 2 ? 'both' : (person.sharedWithMe[0] ?? 'none'),
          })}
        </p>
      ) : (
        <p className="text-small text-muted">
          {t('family.whoSees', {
            profile: memberNames(person.shares.profile) || t('family.nobody'),
            finances: memberNames(person.shares.finances) || t('family.nobody'),
          })}
        </p>
      )}
      {person.keptByMe && (
        <KeptActions person={person} isMe={isMe} others={others} askSharing={askSharing} />
      )}
    </li>
  );
}

type Panel = 'sharing' | 'edit' | 'handOver';

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
  const [panel, setPanel] = useState<Panel | undefined>(
    askSharing && others.length > 0 ? 'sharing' : undefined,
  );
  const remove = useCaseWrite();
  const withoutAccount = person.accountId === null;
  const toggle = (next: Panel) => {
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

function CheckRow({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-touch cursor-pointer items-center gap-3 rounded-control border border-line bg-surface px-3 py-2 hover:bg-soft has-checked:border-primary has-checked:bg-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
        className="size-4 shrink-0 accent-(--arca-primary)"
      />
      <span className="min-w-0 flex-1 break-words">{label}</span>
    </label>
  );
}

type Membership = 'member' | 'relative';

function MembershipChoice({
  value,
  onChange,
}: {
  readonly value: Membership;
  readonly onChange: (value: Membership) => void;
}) {
  const { t } = useTranslation();
  return (
    <ChoiceGroup<Membership>
      legend={t('family.membership.legend')}
      description={t('family.membership.hint')}
      choices={[
        { value: 'member', label: t('family.membership.member') },
        { value: 'relative', label: t('family.membership.relative') },
      ]}
      value={value}
      onChange={onChange}
    />
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
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
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
    <Section title={t('family.add.title')}>
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
    </Section>
  );
}

type RelationChoice = CaseRelationship['relationship']['kind'];

/** The relationship kinds in the order they are offered; the record keeps every kind listed. */
const relationOffered: Readonly<Record<RelationChoice, true>> = {
  parent: true,
  spouse: true,
  partner: true,
};
const relationChoices = Object.keys(relationOffered) as RelationChoice[];

/** The relationships between the people, and adding one where the viewer keeps a person. */
function Relationships({
  view,
  names,
}: {
  readonly view: CaseView;
  readonly names: ReadonlyMap<string, string>;
}) {
  const { t } = useTranslation();
  const kept = new Set(view.people.flatMap((person) => (person.keptByMe ? [person.id] : [])));
  const [pickedFrom, setPickedFrom] = useState(view.me);
  const [kind, setKind] = useState<RelationChoice>('parent');
  const [pickedTo, setPickedTo] = useState('');
  // Picks that left the case, or the same person twice, are no picks at all.
  const present = new Set(view.people.map(({ id }) => id));
  const from = present.has(pickedFrom) ? pickedFrom : '';
  const to = present.has(pickedTo) && pickedTo !== from ? pickedTo : '';
  // The API takes a relationship where the viewer keeps either end.
  const ready = from !== '' && to !== '' && (kept.has(from) || kept.has(to));
  const add = useCaseWrite();
  const remove = useCaseWrite();
  const select =
    'min-h-touch rounded-control border border-line bg-surface px-3 text-body text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
  const fromId = useId();
  const kindId = useId();
  const toId = useId();
  return (
    <Section title={t('family.relationships.title')}>
      {view.relationships.length === 0 ? (
        <p className="text-muted">{t('family.relationships.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {view.relationships.map(({ id, editable, relationship }) => (
            <li key={id} className="flex flex-wrap items-center justify-between gap-2">
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
            add.run(() =>
              writeCase(passkeys, routes.addCaseRelationship, {
                kind,
                from,
                to,
                details: {},
              }),
            );
          }}
        >
          <p className="font-medium">{t('family.relationships.addTitle')}</p>
          <label htmlFor={fromId} className="font-medium">
            {t('family.relationships.from')}
          </label>
          <select
            id={fromId}
            className={select}
            required
            value={from}
            onChange={(event) => {
              setPickedFrom(event.currentTarget.value);
            }}
          >
            <option value="">{t('family.relationships.pick')}</option>
            {view.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName}
              </option>
            ))}
          </select>
          <label htmlFor={kindId} className="font-medium">
            {t('family.relationships.kind')}
          </label>
          <select
            id={kindId}
            className={select}
            value={kind}
            onChange={(event) => {
              setKind(event.currentTarget.value as RelationChoice);
            }}
          >
            {relationChoices.map((choice) => (
              <option key={choice} value={choice}>
                {t(`family.relationships.choice.${choice}`)}
              </option>
            ))}
          </select>
          <label htmlFor={toId} className="font-medium">
            {t('family.relationships.to')}
          </label>
          <select
            id={toId}
            className={select}
            required
            value={to}
            onChange={(event) => {
              setPickedTo(event.currentTarget.value);
            }}
          >
            <option value="">{t('family.relationships.pick')}</option>
            {view.people
              .filter((person) => person.id !== from)
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
          </select>
          {from !== '' && to !== '' && !ready && (
            <p className="text-small text-muted">{t('family.relationships.notKept')}</p>
          )}
          <Button type="submit" disabled={add.pending || !ready} aria-busy={add.pending}>
            {t('family.relationships.add')}
          </Button>
          <WriteStatus pending={add.pending} failure={add.failure} />
        </form>
      )}
    </Section>
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

/** A destructive action that asks once more, in the page, before it runs. */
function Confirmed({
  label,
  warning,
  confirm,
  disabled,
  onConfirm,
}: {
  readonly label: string;
  readonly warning: string;
  readonly confirm: string;
  readonly disabled: boolean;
  readonly onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button
        type="button"
        className={dangerLinkClass}
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
          className={dangerLinkClass}
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
