import { routes } from '@arca/api-contract/client';
import { Button } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, recoveryKitQuery, sessionQuery, vaultStatusQuery } from '../api.js';
import { newRecoveryCode } from '../enrollment.js';
import { textLinkClass } from '../forms/text-link.js';
import { Page } from '../page.js';
import { RecoveryCodeSheet } from '../recovery-code.js';
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
        <ConfirmedCode code={code} />
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
    <Page title={t('recoveryKit.title')} lead={t('recoveryKit.lead')}>
      {children}
    </Page>
  );
}

function ConfirmedCode({ code }: { readonly code: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <RecoveryCodeSheet
      code={code}
      onSaved={async () => {
        await reach(api.call(routes.confirmRecoveryKit, {}));
        await queryClient.invalidateQueries({ queryKey: recoveryKitQuery.queryKey });
        // A vault's part of the kit follows at its next opening (spec 0003, R6).
        const vault = await queryClient.query(vaultStatusQuery).catch(() => undefined);
        await navigate({ to: vault?.resealDue === true ? '/vault' : '/' });
      }}
    />
  );
}
