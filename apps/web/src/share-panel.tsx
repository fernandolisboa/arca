import { Button } from '@arca/ui';
import { Link } from '@tanstack/react-router';
import type { UseQueryResult } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { OpenedDocument } from './documents.js';
import { textLinkClass } from './forms/text-link.js';
import { sharedInState, type SharePerson, type Sharing } from './sharing.js';

/**
 * Whom one of the owner's documents is shared with (spec 0005, R4): each linked person with the
 * fingerprint of the key a share would use, so the owner can compare it with them first.
 */
export function SharePanel({
  opened,
  sharing,
  disabled,
  onShare,
  onConfirmState,
  onClose,
}: {
  readonly opened: OpenedDocument;
  readonly sharing: UseQueryResult<Sharing>;
  readonly disabled: boolean;
  readonly onShare: (chosen: ReadonlySet<string>) => void;
  readonly onConfirmState: () => void;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const legendId = useId();
  const close = (
    <button type="button" disabled={disabled} className={textLinkClass} onClick={onClose}>
      {t('vault.documents.share.close')}
    </button>
  );

  if (sharing.isPending) return <p className="text-muted">{t('vault.documents.working')}</p>;
  if (sharing.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-ink">{t('vault.documents.share.loadFailure')}</p>
        <Button
          disabled={sharing.isFetching}
          aria-busy={sharing.isFetching}
          onClick={() => void sharing.refetch()}
        >
          {t('vault.documents.retry')}
        </Button>
        {close}
      </div>
    );
  }
  const { view, people } = sharing.data;
  if (view.status === 'invalid') {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-ink">{t('vault.documents.share.invalid')}</p>
        {close}
      </div>
    );
  }
  if (view.status === 'rolled_back') {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-ink">{t('vault.documents.share.rolledBack')}</p>
        <Button disabled={disabled} aria-busy={disabled} onClick={onConfirmState}>
          {t('vault.documents.share.confirmState')}
        </Button>
        {close}
      </div>
    );
  }
  if (people.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted">{t('vault.documents.share.noLinks')}</p>
        <Link to="/invites" className={textLinkClass}>
          {t('vault.documents.share.invite')}
        </Link>
        {close}
      </div>
    );
  }
  return (
    <ShareChoice
      key={view.storedVersion}
      legendId={legendId}
      opened={opened}
      people={people}
      inState={sharedInState(view, opened.document.id)}
      disabled={disabled}
      onShare={onShare}
      close={close}
    />
  );
}

function ShareChoice({
  legendId,
  opened: { document },
  people,
  inState,
  disabled,
  onShare,
  close,
}: {
  readonly legendId: string;
  readonly opened: OpenedDocument;
  readonly people: readonly SharePerson[];
  readonly inState: readonly string[];
  readonly disabled: boolean;
  readonly onShare: (chosen: ReadonlySet<string>) => void;
  readonly close: ReactNode;
}) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(inState));
  // Shares the server holds that the owner's own list does not: never encrypted to again.
  const unconfirmed = document.sharedWith.filter((accountId) => !inState.includes(accountId));
  const toggle = (accountId: string, on: boolean) => {
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(accountId);
      else next.delete(accountId);
      return next;
    });
  };
  const sharing = people.filter(
    ({ accountId, trust }) => chosen.has(accountId) && trust !== 'no_vault',
  ).length;
  return (
    <fieldset aria-labelledby={legendId} className="flex w-full flex-col items-start gap-3">
      <legend id={legendId} className="font-medium">
        {t('vault.documents.share.legend')}
      </legend>
      <p className="text-small text-muted">{t('vault.documents.share.lead')}</p>
      <ul className="flex w-full flex-col gap-3">
        {people.map((person) => (
          <PersonChoice
            key={person.accountId}
            person={person}
            checked={chosen.has(person.accountId)}
            disabled={disabled}
            onChange={(on) => {
              toggle(person.accountId, on);
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
            onShare(chosen);
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
  person: { email, fingerprint, trust },
  checked,
  disabled,
  onChange,
}: {
  readonly person: SharePerson;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (on: boolean) => void;
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
            onChange(event.currentTarget.checked);
          }}
          className="size-5 accent-primary"
        />
        <label htmlFor={inputId} className="break-all">
          {email}
        </label>
      </div>
      <div id={detailsId} className="flex flex-col gap-1 ps-8 text-small text-muted">
        {fingerprint !== null && <p>{t('vault.documents.share.fingerprint', { fingerprint })}</p>}
        {trust !== 'pinned' && <p>{t('vault.documents.share.trust', { trust })}</p>}
      </div>
    </li>
  );
}
