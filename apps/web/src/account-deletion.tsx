import { routes } from '@arca/api-contract/client';
import { Button } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { caseQuery, resetAccount, sessionQuery } from './api.js';
import { textLinkClass } from './forms/text-link.js';
import { passkeys } from './platform.js';
import { commonFailure, reach, type CommonFailure } from './requests.js';
import { stepUpFor } from './step-up.js';
import { useDateFormat } from './use-date-format.js';

/** Each call spends its own `account_deletion` step-up (spec 0004, R9). */
async function requestDeletion(): Promise<string> {
  const route = routes.requestAccountDeletion;
  const approved = await stepUpFor(
    passkeys,
    { action: route.operationId, targets: [] },
    'account_deletion',
  );
  return (await reach(approved.call(route, {}))).dueAt;
}

async function cancelDeletion(): Promise<void> {
  const route = routes.cancelAccountDeletion;
  const approved = await stepUpFor(
    passkeys,
    { action: route.operationId, targets: [] },
    'account_deletion',
  );
  await reach(approved.call(route, {}));
}

type State =
  | 'idle'
  | 'confirming'
  | 'waiting'
  | { readonly dueAt: string }
  | { readonly failure: CommonFailure };

/**
 * The people the account keeps in its case, but its own: erasing the account deletes them unless
 * they are handed over first (spec 0007, R9).
 */
function KeptPeopleWarning() {
  const { t, i18n } = useTranslation();
  const session = useQuery(sessionQuery);
  // An unconfirmed account has no case to read yet (spec 0003, R2).
  const found = useQuery({ ...caseQuery, enabled: session.data?.confirmed === true });
  const view = found.data?.case;
  if (view === undefined || view === null) return null;
  const kept = view.people.filter(({ id, keptByMe }) => keptByMe && id !== view.me);
  if (kept.length === 0) return null;
  const names = new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(
    kept.map(({ displayName }) => displayName),
  );
  return (
    <p className="text-danger-ink">
      {t('settings.accountDeletion.keptPeople', { names })}{' '}
      <Link to="/family" className={textLinkClass}>
        {t('settings.accountDeletion.handOver')}
      </Link>
    </p>
  );
}

/** "Excluir conta" in the settings, for a signed-in account with no deletion waiting. */
export function AccountDeletionSection() {
  const { t } = useTranslation();
  const when = useDateFormat();
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery);
  const [state, setState] = useState<State>('idle');
  const statusRef = useRef<HTMLParagraphElement>(null);
  const requested = typeof state === 'object' && 'dueAt' in state;
  // Once requested, every session has ended, this one too; the result stays on screen.
  if (!requested && (!session.isSuccess || session.data.deletionDueAt !== null)) return null;

  const start = () => {
    setState('waiting');
    requestDeletion()
      .then(async (dueAt) => {
        setState({ dueAt });
        await resetAccount(queryClient);
      })
      .catch((error: unknown) => {
        setState({ failure: commonFailure(error) });
      })
      .finally(() => {
        statusRef.current?.focus();
      });
  };

  const message =
    state === 'waiting'
      ? t('settings.accountDeletion.waiting')
      : typeof state === 'object'
        ? 'dueAt' in state
          ? t('settings.accountDeletion.done', { dueAt: when.format(new Date(state.dueAt)) })
          : t('settings.accountDeletion.failure', { reason: state.failure })
        : '';
  return (
    <section aria-labelledby="account-deletion-title" className="flex flex-col items-start gap-3">
      <h3 id="account-deletion-title" className="text-title font-medium">
        {t('settings.accountDeletion.title')}
      </h3>
      {!requested && <p className="text-muted">{t('settings.accountDeletion.intro')}</p>}
      {state === 'confirming' ? (
        <div className="flex flex-col items-start gap-3">
          <p>{t('settings.accountDeletion.confirmLead')}</p>
          <KeptPeopleWarning />
          <div className="flex flex-wrap gap-3">
            <Button onClick={start}>{t('settings.accountDeletion.confirm')}</Button>
            <Button
              onClick={() => {
                setState('idle');
              }}
            >
              {t('settings.accountDeletion.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        !requested && (
          <Button
            disabled={state === 'waiting'}
            aria-busy={state === 'waiting'}
            onClick={() => {
              setState('confirming');
            }}
          >
            {t('settings.accountDeletion.start')}
          </Button>
        )
      )}
      <p
        ref={statusRef}
        role="status"
        tabIndex={-1}
        className={requested ? 'text-ok-ink' : 'text-ink'}
      >
        {message}
      </p>
    </section>
  );
}

/** While the deletion waits, every session can only show this and cancel it (spec 0004, R9). */
export function DeletionPendingNotice({ dueAt }: { readonly dueAt: string }) {
  const { t } = useTranslation();
  const when = useDateFormat();
  const queryClient = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  const [failure, setFailure] = useState<CommonFailure | 'tooLate'>();
  const cancel = () => {
    setFailure(undefined);
    setWaiting(true);
    cancelDeletion()
      .then(() => queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey }))
      .catch((error: unknown) => {
        // Once due, the erasure owns the account and the cancel finds nothing to cancel.
        setFailure(
          commonFailure(error, ({ code }) => (code === 'not_found' ? 'tooLate' : undefined)),
        );
      })
      .finally(() => {
        setWaiting(false);
      });
  };
  return (
    <section
      aria-labelledby="deletion-pending-title"
      className="flex flex-col items-start gap-3 rounded-card border border-line bg-surface p-4"
    >
      <p id="deletion-pending-title" className="text-warn-ink">
        {t('session.deletionPending', { dueAt: when.format(new Date(dueAt)) })}
      </p>
      <Button disabled={waiting} aria-busy={waiting} onClick={cancel}>
        {t('session.deletionCancel')}
      </Button>
      <p role="status" className="text-ink">
        {waiting
          ? t('settings.accountDeletion.waiting')
          : failure === undefined
            ? ''
            : t('settings.accountDeletion.failure', { reason: failure })}
      </p>
    </section>
  );
}
