import { createCorrectorKeyAction, routes } from '@arca/api-contract/client';
import { Button } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, correctorKeyQuery } from '../api.js';
import { passkeys } from '../platform.js';
import { useCopy } from '../recovery-code.js';
import { commonFailure, reach } from '../requests.js';
import { stepUpFor } from '../step-up.js';

type Notice = 'revoked' | 'failure' | 'tooMany';

/** A new key, shown once; it lives in this component's state only and goes when it closes. */
function NewKey({ value, onDone }: { readonly value: string; readonly onDone: () => void }) {
  const { t } = useTranslation();
  const clipboard = useCopy(value);
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
      <p>{t('knowledge.correctorKey.shown')}</p>
      <code className="font-mono break-all select-all">{value}</code>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={clipboard.copy}>
          {t('knowledge.correctorKey.copy')}
        </Button>
        <span role="status" className="text-small text-muted">
          {clipboard.state === 'copied' ? t('knowledge.correctorKey.copied') : ''}
        </span>
        <Button onClick={onDone}>{t('knowledge.correctorKey.done')}</Button>
      </div>
    </div>
  );
}

/** "Chave da sessão de correção" (ADR-0029): its dates, and making or revoking it. */
export function CorrectorKeySection() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const status = useQuery(correctorKeyQuery);
  const [created, setCreated] = useState<string>();
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const title = t('knowledge.correctorKey.title');

  const run = (change: () => Promise<string | undefined>, done?: Notice) => {
    setNotice(undefined);
    setWorking(true);
    change()
      .then((value) => {
        setCreated(value);
        setNotice(done);
      })
      .catch((error: unknown) => {
        const failure = commonFailure(error);
        if (failure !== 'cancelled') setNotice(failure === 'limited' ? 'tooMany' : 'failure');
      })
      .finally(() => {
        setWorking(false);
        void queryClient.invalidateQueries(correctorKeyQuery);
      });
  };

  const create = () => {
    run(async () => {
      const approved = await stepUpFor(passkeys, createCorrectorKeyAction(), 'corrector_key');
      return (await reach(approved.call(routes.createCorrectorKey))).key;
    });
  };

  if (status.isError) {
    return <p className="text-small text-muted">{t('knowledge.correctorKey.loadFailure')}</p>;
  }
  if (status.data === undefined) return null;
  const { canManage, key } = status.data;
  const date = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(new Date(value));
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h3 className="font-medium">{title}</h3>
      <p className="text-small text-muted">{t('knowledge.correctorKey.lead')}</p>
      <p>
        {key === null
          ? t('knowledge.correctorKey.none')
          : t('knowledge.correctorKey.active', {
              created: date(key.createdAt),
              expires: date(key.expiresAt),
            })}
      </p>
      {created !== undefined && (
        <NewKey
          value={created}
          onDone={() => {
            setCreated(undefined);
          }}
        />
      )}
      {canManage ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={working} onClick={create}>
            {working
              ? t('knowledge.correctorKey.working')
              : t(
                  key === null ? 'knowledge.correctorKey.create' : 'knowledge.correctorKey.replace',
                )}
          </Button>
          {key !== null && (
            <Button
              variant="secondary"
              disabled={working}
              onClick={() => {
                run(async () => {
                  await reach(api.call(routes.revokeCorrectorKey, { id: key.id }));
                  return undefined;
                }, 'revoked');
              }}
            >
              {t('knowledge.correctorKey.revoke')}
            </Button>
          )}
          {key !== null && (
            <p className="w-full text-small text-muted">
              {t('knowledge.correctorKey.replaceHint')}
            </p>
          )}
        </div>
      ) : (
        <p className="text-small text-muted">{t('knowledge.correctorKey.ownerOnly')}</p>
      )}
      <p role="status" className="text-small">
        {notice === undefined ? '' : t(`knowledge.correctorKey.${notice}`)}
      </p>
    </section>
  );
}
