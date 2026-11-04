import { routes } from '@arca/api-contract/client';
import { Button } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sessionQuery } from './api.js';
import { download } from './download.js';
import { passkeys } from './platform.js';
import { commonFailure, reach, type CommonFailure } from './requests.js';
import { stepUpFor } from './step-up.js';

/** The export after its own `data_export` step-up (spec 0004, R8), saved as a JSON file. */
async function exportAccountData(fileName: (date: string) => string): Promise<void> {
  const route = routes.exportAccountData;
  const approved = await stepUpFor(
    passkeys,
    { action: route.operationId, targets: [] },
    'data_export',
  );
  const document = await reach(approved.call(route, {}));
  download(
    fileName(document.exportedAt.slice(0, 10)),
    JSON.stringify(document, null, 2),
    'application/json',
  );
}

type State = 'idle' | 'confirming' | 'waiting' | 'done' | { readonly failure: CommonFailure };

/** "Seus dados" in the settings, shown only to a signed-in account. */
export function DataExportSection() {
  const { t } = useTranslation();
  const session = useQuery(sessionQuery);
  const [state, setState] = useState<State>('idle');
  const statusRef = useRef<HTMLParagraphElement>(null);
  if (!session.isSuccess) return null;

  const start = () => {
    setState('waiting');
    exportAccountData((date) => t('settings.dataExport.fileName', { date }))
      .then(() => {
        setState('done');
      })
      .catch((error: unknown) => {
        setState({ failure: commonFailure(error) });
      })
      .finally(() => {
        // The buttons that had focus leave, so focus moves to the result.
        statusRef.current?.focus();
      });
  };

  const message =
    state === 'waiting'
      ? t('settings.dataExport.waiting')
      : state === 'done'
        ? t('settings.dataExport.done')
        : typeof state === 'object'
          ? t('settings.dataExport.failure', { reason: state.failure })
          : '';
  return (
    <section aria-labelledby="data-export-title" className="flex flex-col items-start gap-3">
      <h3 id="data-export-title" className="text-title font-medium">
        {t('settings.dataExport.title')}
      </h3>
      <p className="text-muted">{t('settings.dataExport.intro')}</p>
      {state === 'confirming' ? (
        <div className="flex flex-col items-start gap-3">
          <p>{t('settings.dataExport.confirmLead')}</p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={start}>{t('settings.dataExport.confirm')}</Button>
            <Button
              onClick={() => {
                setState('idle');
              }}
            >
              {t('settings.dataExport.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          disabled={state === 'waiting'}
          aria-busy={state === 'waiting'}
          onClick={() => {
            setState('confirming');
          }}
        >
          {t('settings.dataExport.start')}
        </Button>
      )}
      <p
        ref={statusRef}
        role="status"
        tabIndex={-1}
        className={state === 'done' ? 'text-ok-ink' : 'text-ink'}
      >
        {message}
      </p>
    </section>
  );
}
