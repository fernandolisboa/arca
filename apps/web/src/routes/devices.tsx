import {
  pendingPasskeyHours,
  type DevicePasskey,
  type DeviceSession,
} from '@arca/api-contract/client';
import { Button } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  devicesQuery,
  recoveryKitQuery,
  resetAccount,
  sessionQuery,
  vaultStatusQuery,
} from '../api.js';
import {
  addPasskey,
  deviceFailure,
  revokeOtherSessions,
  revokePasskey,
  revokeSession,
  type DeviceFailure,
} from '../devices.js';
import { dangerLinkClass, textLinkClass } from '../forms/text-link.js';
import { Page } from '../page.js';
import { passkeys } from '../platform.js';
import { useDateFormat } from '../use-date-format.js';

export const Route = createFileRoute('/devices')({ component: Devices });

type Done =
  | 'added'
  | 'sessionRevoked'
  | 'passkeyRevoked'
  | 'pendingCancelled'
  | 'recoveryCancelled'
  | 'othersRevoked';

interface Change {
  readonly run: () => Promise<void>;
  readonly done: Done;
  /** The change ends this browser's own session, so nothing of the account may stay cached. */
  readonly endsThisSession?: boolean;
}

function Devices() {
  const { t } = useTranslation();
  const session = useQuery(sessionQuery);
  const devices = useQuery({ ...devicesQuery, enabled: session.isSuccess });
  // A session restricted by a pending recovery may not read the vault (spec 0003, R6).
  const vault = useQuery({
    ...vaultStatusQuery,
    enabled: session.isSuccess && !session.data.recoveryPending,
  });
  const queryClient = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  const [outcome, setOutcome] = useState<{ done: Done } | { failure: DeviceFailure }>();
  const statusRef = useRef<HTMLParagraphElement>(null);

  if (session.isError) {
    return (
      <Page title={t('devices.title')}>
        <p>{t('devices.signIn')}</p>
        <Link to="/sign-in" className={textLinkClass}>
          {t('session.signIn')}
        </Link>
      </Page>
    );
  }

  const change = ({ run, done, endsThisSession = false }: Change) => {
    setOutcome(undefined);
    setWaiting(true);
    run()
      .then(async () => {
        setOutcome({ done });
        // The control that had focus may leave with its card, so focus moves to the result.
        statusRef.current?.focus();
        await (endsThisSession
          ? resetAccount(queryClient)
          : Promise.all([
              queryClient.invalidateQueries({ queryKey: devicesQuery.queryKey }),
              queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey }),
              // Cancelling a recovery deletes the recovery code, so the kit is missing again.
              queryClient.invalidateQueries({ queryKey: recoveryKitQuery.queryKey }),
              // Removing a passkey that could open the vault makes a rotation due (ADR-0018).
              queryClient.invalidateQueries({ queryKey: vaultStatusQuery.queryKey }),
            ]));
      })
      .catch((error: unknown) => {
        setOutcome({ failure: deviceFailure(error) });
      })
      .finally(() => {
        setWaiting(false);
      });
  };

  // While a recovery passkey waits, cancelling it is all this session may do (spec 0003, R6).
  const restricted = session.data?.recoveryPending === true;
  const message = waiting
    ? t('devices.waiting')
    : outcome === undefined
      ? ''
      : 'done' in outcome
        ? t('devices.done', { done: outcome.done, hours: pendingPasskeyHours })
        : t('devices.failure', { reason: outcome.failure });

  return (
    <Page title={t('devices.title')} lead={t('devices.lead')}>
      {/* One live region whose text changes, so each new state is announced. */}
      <p
        ref={statusRef}
        role="status"
        tabIndex={-1}
        className={outcome !== undefined && 'done' in outcome ? 'text-ok-ink' : 'text-ink'}
      >
        {message}
      </p>
      <RotateOffer
        due={
          outcome !== undefined &&
          'done' in outcome &&
          outcome.done === 'passkeyRevoked' &&
          vault.data?.rotationDue === true
        }
      />
      {restricted ? (
        <p className="text-warn-ink">{t('devices.restricted')}</p>
      ) : (
        <section aria-labelledby="add-passkey-title" className="flex flex-col items-start gap-3">
          <h3 id="add-passkey-title" className="font-display text-lead">
            {t('devices.addTitle')}
          </h3>
          <p className="text-muted">{t('devices.addLead', { hours: pendingPasskeyHours })}</p>
          <Button
            disabled={waiting}
            aria-busy={waiting}
            onClick={() => {
              change({ run: () => addPasskey(passkeys), done: 'added' });
            }}
          >
            {t('devices.add')}
          </Button>
        </section>
      )}
      {devices.isError && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-ink">{t('devices.listFailure')}</p>
          <Button
            disabled={devices.isFetching}
            aria-busy={devices.isFetching}
            onClick={() => void devices.refetch()}
          >
            {t('devices.retry')}
          </Button>
        </div>
      )}
      {devices.isSuccess && (
        <>
          <ul aria-label={t('devices.listTitle')} className="flex flex-col gap-3">
            {devices.data.passkeys.map((passkey) => (
              <PasskeyCard
                key={passkey.id}
                passkey={passkey}
                waiting={waiting}
                restricted={restricted}
                onChange={change}
              />
            ))}
          </ul>
          {!restricted && (
            <button
              type="button"
              disabled={waiting}
              className={`${dangerLinkClass} self-start`}
              onClick={() => {
                change({ run: () => revokeOtherSessions(passkeys), done: 'othersRevoked' });
              }}
            >
              {t('devices.revokeOthers')}
            </button>
          )}
        </>
      )}
    </Page>
  );
}

/**
 * Any active passkey may have opened the vault, through PRF or an identity wrapped on its device.
 * Its own live region, since the offer follows the vault status read after the removal.
 */
function RotateOffer({ due }: { readonly due: boolean }) {
  const { t } = useTranslation();
  return (
    <div role="status" className="flex flex-col items-start gap-1">
      {due && (
        <>
          <p>{t('devices.rotateOffer')}</p>
          <Link to="/vault" className={textLinkClass}>
            {t('devices.rotateLink')}
          </Link>
        </>
      )}
    </div>
  );
}

function PasskeyCard({
  passkey,
  waiting,
  restricted,
  onChange,
}: {
  readonly passkey: DevicePasskey;
  readonly waiting: boolean;
  readonly restricted: boolean;
  readonly onChange: (change: Change) => void;
}) {
  const { t } = useTranslation();
  const when = useDateFormat();
  const pending = passkey.state === 'pending';
  const done = passkey.recovery
    ? 'recoveryCancelled'
    : pending
      ? 'pendingCancelled'
      : 'passkeyRevoked';
  return (
    <li className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <p className="font-medium">
          {passkey.createdAt === null
            ? t('devices.passkey')
            : t('devices.passkeyCreated', { created: when.format(new Date(passkey.createdAt)) })}
        </p>
        {passkey.current && <p className="text-small text-muted">{t('devices.thisPasskey')}</p>}
        {pending && passkey.activeFrom !== null && (
          <p className="text-warn-ink">
            {t(passkey.recovery ? 'devices.recoveryPasskey' : 'devices.pending', {
              activeFrom: when.format(new Date(passkey.activeFrom)),
            })}
          </p>
        )}
      </div>
      {passkey.sessions.length > 0 && (
        <ul aria-label={t('devices.sessionsOf')} className="flex flex-col gap-2">
          {passkey.sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              waiting={waiting}
              restricted={restricted}
              onChange={onChange}
            />
          ))}
        </ul>
      )}
      {(!restricted || passkey.recovery) && (
        <button
          type="button"
          disabled={waiting}
          className={`${dangerLinkClass} self-start`}
          onClick={() => {
            onChange({
              run: () => revokePasskey(passkeys, passkey.id),
              done,
              endsThisSession: passkey.current,
            });
          }}
        >
          {t(
            passkey.recovery
              ? 'devices.cancelRecovery'
              : pending
                ? 'devices.cancelPending'
                : 'devices.revokePasskey',
          )}
        </button>
      )}
    </li>
  );
}

function SessionRow({
  session,
  waiting,
  restricted,
  onChange,
}: {
  readonly session: DeviceSession;
  readonly waiting: boolean;
  readonly restricted: boolean;
  readonly onChange: (change: Change) => void;
}) {
  const { t } = useTranslation();
  const when = useDateFormat();
  return (
    <li className="flex flex-col gap-1 border-t border-line pt-2">
      <p>
        {t('devices.sessionDevice', {
          browser: t('device.browser', { browser: session.device.browser }),
          os: t('device.os', { os: session.device.os }),
        })}
      </p>
      <p className="text-small text-muted">
        {t('devices.sessionTimes', {
          created: when.format(new Date(session.createdAt)),
          lastUsed: when.format(new Date(session.lastUsedAt)),
        })}
      </p>
      {session.current ? (
        <p className="text-small text-muted">{t('devices.thisDevice')}</p>
      ) : restricted ? null : (
        <button
          type="button"
          disabled={waiting}
          className={`${dangerLinkClass} self-start`}
          onClick={() => {
            onChange({ run: () => revokeSession(passkeys, session.id), done: 'sessionRevoked' });
          }}
        >
          {t('devices.revokeSession')}
        </button>
      )}
    </li>
  );
}
