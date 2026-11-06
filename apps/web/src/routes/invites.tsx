import { inviteLifetimeHours, maxOpenInvites, type Invite } from '@arca/api-contract/client';
import { Button, ChoiceGroup } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { caseQuery, invitesQuery, sessionQuery } from '../api.js';
import { addFailure, addToCase, type AddFailure } from '../case-members.js';
import { emailInput, nameInput } from '../forms/inputs.js';
import { TextField } from '../forms/text-field.js';
import { dangerLinkClass, textLinkClass } from '../forms/text-link.js';
import {
  decideInvite,
  decisionFailure,
  sendFailure,
  sendInvite,
  type Decision,
  type DecisionFailure,
  type SendFailure,
} from '../invites.js';
import { Page } from '../page.js';
import { passkeys } from '../platform.js';

export const Route = createFileRoute('/invites')({ component: Invites });

/** Someone else's address: the browser should not offer the inviter's own. */
const inviteeInput = { ...emailInput, autoComplete: 'off' } as const;

function Invites() {
  const { t } = useTranslation();
  const session = useQuery(sessionQuery);
  if (session.isError) {
    return (
      <Page title={t('invites.title')}>
        <p>{t('invites.signIn')}</p>
        <Link to="/sign-in" className={textLinkClass}>
          {t('session.signIn')}
        </Link>
      </Page>
    );
  }
  if (!session.isSuccess) return <Page title={t('invites.title')} />;
  if (!session.data.confirmed) {
    return (
      <Page title={t('invites.title')}>
        <p>{t('session.unconfirmed')}</p>
      </Page>
    );
  }
  return (
    <Page title={t('invites.title')} lead={t('invites.lead', { hours: inviteLifetimeHours })}>
      <SendInvite />
      <InviteList />
    </Page>
  );
}

function SendInvite() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string>();
  const [failure, setFailure] = useState<SendFailure>();

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(undefined);
    setSent(undefined);
    setSending(true);
    sendInvite(email)
      .then(async () => {
        setSent(email);
        setEmail('');
        await queryClient.invalidateQueries({ queryKey: invitesQuery.queryKey });
      })
      .catch((error: unknown) => {
        setFailure(sendFailure(error));
      })
      .finally(() => {
        setSending(false);
      });
  };

  const message = sending
    ? t('invites.sending')
    : sent !== undefined
      ? t('invites.sent', { email: sent })
      : failure === undefined
        ? ''
        : t('invites.sendFailure', { reason: failure, max: maxOpenInvites });

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <TextField
        label={t('invites.email')}
        {...inviteeInput}
        value={email}
        onChange={(event) => {
          setEmail(event.currentTarget.value);
        }}
      />
      <Button type="submit" disabled={sending} aria-busy={sending}>
        {t('invites.submit')}
      </Button>
      {/* One live region whose text changes, so each new state is announced. */}
      <p role="status" className={failure === undefined ? 'text-muted' : 'text-ink'}>
        {message}
      </p>
    </form>
  );
}

function InviteList() {
  const { t, i18n } = useTranslation();
  const invites = useQuery(invitesQuery);
  const [decided, setDecided] = useState<{ decision: Decision; email: string }>();
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  return (
    <section aria-labelledby="invite-list-title" className="flex flex-col gap-3">
      <h3 id="invite-list-title" className="font-display text-lead">
        {t('invites.listTitle')}
      </h3>
      <p role="status" className="text-ok-ink">
        {decided === undefined
          ? ''
          : t(decided.decision === 'confirm' ? 'invites.confirmed' : 'invites.declined', {
              email: decided.email,
            })}
      </p>
      {invites.isError && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-ink">{t('invites.listFailure')}</p>
          <Button
            disabled={invites.isFetching}
            aria-busy={invites.isFetching}
            onClick={() => void invites.refetch()}
          >
            {t('invites.retry')}
          </Button>
        </div>
      )}
      {invites.isSuccess && invites.data.invites.length === 0 && (
        <p className="text-muted">{t('invites.empty')}</p>
      )}
      <ul className="flex flex-col gap-3">
        {invites.data?.invites.map((invite) => (
          <li key={invite.id} className="rounded-card border border-line bg-surface p-4">
            <p className="font-medium break-all">{invite.email}</p>
            <p className="text-small text-muted">
              {t('invites.status', {
                status: invite.status,
                expires: when.format(new Date(invite.expiresAt)),
              })}
            </p>
            {invite.status === 'accepted' && (
              <Review
                invite={invite}
                onDecided={(decision) => {
                  setDecided({ decision, email: invite.email });
                }}
              />
            )}
            {invite.accountId !== null && (
              <AddToCase email={invite.email} accountId={invite.accountId} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The inviter checks the address and decides; either way, a step-up bound to the invite. */
function Review({
  invite,
  onDecided,
}: {
  readonly invite: Invite;
  readonly onDecided: (decision: Decision) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  const [failure, setFailure] = useState<DecisionFailure>();

  const decide = (decision: Decision) => {
    setFailure(undefined);
    setWaiting(true);
    decideInvite(passkeys, decision, invite.id)
      .then(async () => {
        onDecided(decision);
        await queryClient.invalidateQueries({ queryKey: invitesQuery.queryKey });
      })
      .catch((error: unknown) => {
        setFailure(decisionFailure(error));
      })
      .finally(() => {
        setWaiting(false);
      });
  };

  return (
    <div className="mt-3 flex flex-col gap-3">
      <p className="font-medium">{t('invites.reviewTitle', { email: invite.email })}</p>
      <p className="text-muted">{t('invites.reviewLead')}</p>
      <p className="text-small text-muted">{t('invites.noVault')}</p>
      <Button
        disabled={waiting}
        aria-busy={waiting}
        onClick={() => {
          decide('confirm');
        }}
      >
        {t('invites.confirm')}
      </Button>
      <button
        type="button"
        disabled={waiting}
        className={dangerLinkClass}
        onClick={() => {
          decide('decline');
        }}
      >
        {t('invites.decline')}
      </button>
      <p role="status" className={failure === undefined && !waiting ? 'text-muted' : 'text-ink'}>
        {waiting
          ? t('invites.waiting')
          : failure === undefined
            ? ''
            : t('invites.decisionFailure', { reason: failure })}
      </p>
    </div>
  );
}

/** A new person, or the ID of a person the inviter keeps who has no account yet. */
const newPerson = 'new';

/**
 * Right after confirming, the inviter adds the account to their case (spec 0007, R2): as someone
 * new, or as a person they already described, who then keeps their own data.
 */
function AddToCase({ email, accountId }: { readonly email: string; readonly accountId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const familyCase = useQuery(caseQuery);
  const [chosen, setChosen] = useState(newPerson);
  const [displayName, setDisplayName] = useState('');
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<AddFailure>();
  const view = familyCase.data?.case;
  if (view === undefined || view === null) return null;
  if (view.people.some((person) => person.accountId === accountId)) {
    return <p className="mt-3 text-small text-muted">{t('invites.inCase', { email })}</p>;
  }
  const described = view.people.filter((person) => person.keptByMe && person.accountId === null);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(undefined);
    setAdding(true);
    addToCase(
      passkeys,
      chosen === newPerson
        ? { accountId, displayName: displayName.trim() }
        : { accountId, personId: chosen },
    )
      .then((updated) => {
        queryClient.setQueryData(caseQuery.queryKey, { case: updated });
      })
      .catch((error: unknown) => {
        setFailure(addFailure(error));
      })
      .finally(() => {
        setAdding(false);
      });
  };

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
      <p className="font-medium">{t('invites.addTitle', { email })}</p>
      <p className="text-muted">{t('invites.addLead')}</p>
      {described.length > 0 && (
        <ChoiceGroup
          legend={t('invites.addAs')}
          description={t('invites.addAsHint')}
          choices={[
            { value: newPerson, label: t('invites.addNew') },
            ...described.map((person) => ({ value: person.id, label: person.displayName })),
          ]}
          value={chosen}
          onChange={setChosen}
        />
      )}
      {chosen === newPerson && (
        <TextField
          label={t('invites.addName')}
          {...nameInput}
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.currentTarget.value);
          }}
        />
      )}
      <Button type="submit" disabled={adding} aria-busy={adding}>
        {t('invites.addSubmit')}
      </Button>
      <p role="status" className={failure === undefined && !adding ? 'text-muted' : 'text-ink'}>
        {adding
          ? t(chosen === newPerson ? 'invites.adding' : 'invites.waiting')
          : failure === undefined
            ? ''
            : t('invites.addFailure', { reason: failure })}
      </p>
    </form>
  );
}
