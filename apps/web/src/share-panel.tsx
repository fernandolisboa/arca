import { Button } from '@arca/ui';
import { Link } from '@tanstack/react-router';
import type { UseQueryResult } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { OpenedDocument } from './documents.js';
import { textLinkClass } from './forms/text-link.js';
import {
  sharedInState,
  type SharePerson,
  type Sharing,
  type SharingView,
} from './share-recipients.js';
import { toggled } from './sets.js';

/**
 * Whom one of the owner's documents is shared with (spec 0005, R4): each linked person with the
 * fingerprint of their vault key, so the owner can compare it with them first.
 */
export function SharePanel({
  id,
  opened,
  name,
  names,
  sharing,
  disabled,
  onShare,
  onConfirmState,
  onClose,
}: {
  readonly id: string;
  readonly opened: OpenedDocument;
  /** This document's name, so each open panel says which document it is for. */
  readonly name: string;
  /** Every document's name the vault opened, by ID, for the rolled-back list. */
  readonly names: ReadonlyMap<string, string>;
  readonly sharing: UseQueryResult<Sharing>;
  readonly disabled: boolean;
  readonly onShare: (chosen: ReadonlySet<string>, accepted: ReadonlySet<string>) => void;
  readonly onConfirmState: () => void;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const close = (
    <button type="button" disabled={disabled} className={textLinkClass} onClick={onClose}>
      {t('vault.documents.share.close')}
    </button>
  );
  const shell = (children: ReactNode) => (
    <div id={id} className="flex w-full flex-col items-start gap-3">
      {children}
    </div>
  );

  if (sharing.isPending) return shell(<p className="text-muted">{t('vault.documents.working')}</p>);
  if (sharing.isError) {
    return shell(
      <>
        <p className="text-ink">{t('vault.documents.share.loadFailure')}</p>
        <Button
          disabled={sharing.isFetching}
          aria-busy={sharing.isFetching}
          onClick={() => void sharing.refetch()}
        >
          {t('vault.documents.retry')}
        </Button>
        {close}
      </>,
    );
  }
  const { view, people } = sharing.data;
  if (view.status === 'invalid') {
    return shell(
      <>
        <p className="text-ink">{t('vault.documents.share.invalid')}</p>
        {close}
      </>,
    );
  }
  if (view.status === 'rolled_back') {
    return shell(
      <>
        <p className="text-ink">{t('vault.documents.share.rolledBack')}</p>
        <RolledBackList view={view} people={people} names={names} />
        <Button disabled={disabled} aria-busy={disabled} onClick={onConfirmState}>
          {t('vault.documents.share.confirmState')}
        </Button>
        {close}
      </>,
    );
  }
  if (people.length === 0) {
    return shell(
      <>
        <p className="text-muted">{t('vault.documents.share.noLinks')}</p>
        <Link to="/invites" className={textLinkClass}>
          {t('vault.documents.share.invite')}
        </Link>
        {close}
      </>,
    );
  }
  return shell(
    <ShareChoice
      key={view.storedVersion}
      opened={opened}
      name={name}
      people={people}
      inState={sharedInState(view, opened.document.id)}
      disabled={disabled}
      onShare={onShare}
      close={close}
    />,
  );
}

/** What the rolled-back state says, document by document, for the owner to check first. */
function RolledBackList({
  view,
  people,
  names,
}: {
  readonly view: SharingView;
  readonly people: readonly SharePerson[];
  readonly names: ReadonlyMap<string, string>;
}) {
  const { t, i18n } = useTranslation();
  const list = new Intl.ListFormat(i18n.language, { type: 'conjunction' });
  const emails = new Map(people.map(({ accountId, email }) => [accountId, email]));
  const shared = Object.entries(view.state.documents).filter(
    ([, accountIds]) => accountIds.length > 0,
  );
  if (shared.length === 0) {
    return <p className="text-ink">{t('vault.documents.share.rolledBackEmpty')}</p>;
  }
  return (
    <ul aria-label={t('vault.documents.share.rolledBackList')} className="flex flex-col gap-2">
      {shared.map(([documentId, accountIds]) => (
        <li key={documentId} className="break-words">
          {t('vault.documents.share.rolledBackItem', {
            name: names.get(documentId) ?? t('vault.documents.unnamed'),
            people: list.format(
              accountIds.map(
                (accountId) => emails.get(accountId) ?? t('vault.documents.share.unlinked'),
              ),
            ),
          })}
        </li>
      ))}
    </ul>
  );
}

function ShareChoice({
  opened: { document },
  name,
  people,
  inState,
  disabled,
  onShare,
  close,
}: {
  readonly opened: OpenedDocument;
  readonly name: string;
  readonly people: readonly SharePerson[];
  readonly inState: readonly string[];
  readonly disabled: boolean;
  readonly onShare: (chosen: ReadonlySet<string>, accepted: ReadonlySet<string>) => void;
  readonly close: ReactNode;
}) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(inState));
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(() => new Set());
  // Shares the server holds that the owner's own list does not: never encrypted to again.
  const unconfirmed = document.sharedWith.filter((accountId) => !inState.includes(accountId));
  const sharing = people.filter(
    ({ accountId, trust }) => chosen.has(accountId) && trust !== 'no_vault',
  ).length;
  return (
    <fieldset className="flex w-full flex-col items-start gap-3">
      <legend className="font-medium break-words">
        {t('vault.documents.share.legend', { name })}
      </legend>
      <p className="text-small text-muted">{t('vault.documents.share.lead')}</p>
      <ul className="flex w-full flex-col gap-3">
        {people.map((person) => (
          <PersonChoice
            key={person.accountId}
            person={person}
            checked={chosen.has(person.accountId)}
            accepted={accepted.has(person.accountId)}
            disabled={disabled}
            onCheck={(on) => {
              setChosen((current) => toggled(current, person.accountId, on));
            }}
            onAccept={(on) => {
              setAccepted((current) => toggled(current, person.accountId, on));
            }}
          />
        ))}
      </ul>
      {unconfirmed.length > 0 && (
        <p className="text-ink">
          {t('vault.documents.share.unconfirmed', { count: unconfirmed.length })}
        </p>
      )}
      <p className="text-ink">{t('vault.documents.share.summary', { count: sharing })}</p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Button
          disabled={disabled}
          aria-busy={disabled}
          onClick={() => {
            onShare(chosen, accepted);
          }}
        >
          {t('vault.documents.share.save')}
        </Button>
        {close}
      </div>
    </fieldset>
  );
}

function PersonChoice({
  person: { email, trust, pinned, offered },
  checked,
  accepted,
  disabled,
  onCheck,
  onAccept,
}: {
  readonly person: SharePerson;
  readonly checked: boolean;
  readonly accepted: boolean;
  readonly disabled: boolean;
  readonly onCheck: (on: boolean) => void;
  readonly onAccept: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const detailsId = useId();
  return (
    <li className="flex flex-col gap-1">
      <div className="flex min-h-touch items-center gap-3">
        <input
          id={inputId}
          type="checkbox"
          checked={checked && trust !== 'no_vault'}
          disabled={disabled || trust === 'no_vault'}
          aria-describedby={detailsId}
          onChange={(event) => {
            onCheck(event.currentTarget.checked);
          }}
          className="size-5 accent-primary"
        />
        <label htmlFor={inputId} className="break-all">
          {email}
        </label>
      </div>
      <div id={detailsId} className="flex flex-col items-start gap-1 ps-8 text-small text-muted">
        {pinned !== null && (
          <p>{t('vault.documents.share.fingerprint', { fingerprint: pinned.fingerprint })}</p>
        )}
        {trust === 'new' && offered !== null && (
          <p>{t('vault.documents.share.fingerprint', { fingerprint: offered.fingerprint })}</p>
        )}
        {trust === 'changed' && offered !== null && (
          <p>{t('vault.documents.share.newFingerprint', { fingerprint: offered.fingerprint })}</p>
        )}
        {trust !== 'pinned' && (
          <p>{t('vault.documents.share.trust', { trust: accepted ? 'accepted' : trust })}</p>
        )}
      </div>
      {trust === 'changed' && (
        <button
          type="button"
          disabled={disabled}
          aria-describedby={detailsId}
          aria-pressed={accepted}
          className={`${textLinkClass} ms-8 self-start`}
          onClick={() => {
            onAccept(!accepted);
          }}
        >
          {t(accepted ? 'vault.documents.share.keepPinned' : 'vault.documents.share.acceptKey')}
        </button>
      )}
    </li>
  );
}
