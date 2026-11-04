import { routes } from '@arca/api-contract/client';
import { Button } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, recoveryKitQuery, sessionQuery } from '../api.js';
import { groupCode, newRecoveryCode } from '../enrollment.js';
import { textLinkClass } from '../forms/text-link.js';
import { passkeys } from '../platform.js';
import { commonFailure, reach, type CommonFailure } from '../requests.js';

export const Route = createFileRoute('/recovery-kit')({ component: RecoveryKit });

function RecoveryKit() {
  const { t } = useTranslation();
  const session = useQuery(sessionQuery);
  const status = useQuery({ ...recoveryKitQuery, enabled: session.isSuccess });
  // The code lives only in this screen's state: it is shown once and never cached.
  const [code, setCode] = useState<string>();
  const [waiting, setWaiting] = useState(false);
  const [failure, setFailure] = useState<CommonFailure>();

  if (session.isError) {
    return (
      <Section>
        <p>{t('recoveryKit.signIn')}</p>
        <Link to="/sign-in" className={textLinkClass}>
          {t('session.signIn')}
        </Link>
      </Section>
    );
  }
  if (code !== undefined) {
    return (
      <Section>
        <ShownCode code={code} />
      </Section>
    );
  }
  if (status.isError) {
    return (
      <Section>
        <p role="status">{t('recoveryKit.failure', { reason: commonFailure(status.error) })}</p>
      </Section>
    );
  }
  if (!status.isSuccess) return <Section />;

  const replace = status.data.status !== 'none';
  const issue = () => {
    setFailure(undefined);
    setWaiting(true);
    newRecoveryCode(passkeys, { replace })
      .then(setCode)
      .catch((error: unknown) => {
        setFailure(commonFailure(error));
      })
      .finally(() => {
        setWaiting(false);
      });
  };
  const message = waiting
    ? t('recoveryKit.waiting')
    : failure === undefined
      ? ''
      : t('recoveryKit.failure', { reason: failure });

  return (
    <Section>
      {status.data.status === 'saved' && <p>{t('recoveryKit.savedLead')}</p>}
      {replace && <p className="text-muted">{t('recoveryKit.replaceLead')}</p>}
      <Button disabled={waiting} aria-busy={waiting} onClick={issue}>
        {replace ? t('recoveryKit.replace') : t('recoveryKit.show')}
      </Button>
      {/* One live region whose text changes, so each new state is announced. */}
      <p role="status" className={failure === undefined && !waiting ? 'text-muted' : 'text-ink'}>
        {message}
      </p>
    </Section>
  );
}

function Section({ children }: { readonly children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="kit-title" className="mx-auto flex max-w-md flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id="kit-title" className="font-display text-title">
          {t('recoveryKit.title')}
        </h2>
        <p className="text-muted">{t('recoveryKit.lead')}</p>
      </div>
      {children}
    </section>
  );
}

/** Starts a download of the text in the browser; the file never passes through the server. */
function download(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ShownCode({ code }: { readonly code: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const labelId = useId();
  const savedId = useId();
  const [warned, setWarned] = useState(false);
  const [saved, setSaved] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [failure, setFailure] = useState<CommonFailure>();
  const grouped = groupCode(code);

  const finish = () => {
    setFailure(undefined);
    setFinishing(true);
    reach(api.call(routes.confirmRecoveryKit, {}))
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: recoveryKitQuery.queryKey });
        await navigate({ to: '/' });
      })
      .catch((error: unknown) => {
        setFailure(commonFailure(error));
        setFinishing(false);
      });
  };

  return (
    <>
      <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
        <p id={labelId} className="font-medium">
          {t('recoveryKit.codeLabel')}
        </p>
        <p
          aria-labelledby={labelId}
          className="font-mono text-lead tracking-wider break-all text-ink"
          translate="no"
        >
          {grouped}
        </p>
      </div>
      <p>{t('recoveryKit.keep')}</p>
      <div className="flex flex-col gap-2 print:hidden">
        <Button
          onClick={() => {
            window.print();
          }}
        >
          {t('recoveryKit.print')}
        </Button>
        {warned ? (
          <>
            <p className="text-muted">{t('recoveryKit.downloadWarning')}</p>
            <button
              type="button"
              className={textLinkClass}
              onClick={() => {
                download(t('recoveryKit.fileName'), t('recoveryKit.fileText', { code: grouped }));
              }}
            >
              {t('recoveryKit.downloadAnyway')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className={textLinkClass}
            onClick={() => {
              setWarned(true);
            }}
          >
            {t('recoveryKit.download')}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-4 print:hidden">
        <div className="flex min-h-touch items-center gap-3">
          <input
            id={savedId}
            type="checkbox"
            checked={saved}
            onChange={(event) => {
              setSaved(event.currentTarget.checked);
            }}
            className="size-5 accent-primary"
          />
          <label htmlFor={savedId}>{t('recoveryKit.saved')}</label>
        </div>
        <Button disabled={!saved || finishing} aria-busy={finishing} onClick={finish}>
          {t('recoveryKit.finish')}
        </Button>
        <p role="status" className={failure === undefined ? 'text-muted' : 'text-ink'}>
          {failure === undefined ? '' : t('recoveryKit.failure', { reason: failure })}
        </p>
      </div>
    </>
  );
}
