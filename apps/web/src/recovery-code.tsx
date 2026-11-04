import { Button } from '@arca/ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { groupCode } from './enrollment.js';
import { textLinkClass } from './forms/text-link.js';
import { commonFailure, type CommonFailure } from './requests.js';

/** Starts a download of the text in the browser; the file never passes through the server. */
function download(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  // Some browsers start reading the file only after the click returns.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}

/**
 * The account recovery code, shown once (spec 0003, R6): print, a text file behind its warning,
 * and a checkbox before `onSaved`, which the screen that issued the code supplies.
 */
export function RecoveryCodeSheet({
  code,
  onSaved,
}: {
  readonly code: string;
  readonly onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
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
    onSaved().catch((error: unknown) => {
      setFailure(commonFailure(error));
      setFinishing(false);
    });
  };

  return (
    <>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4"
      >
        <p id={labelId} className="font-medium">
          {t('recoveryKit.codeLabel')}
        </p>
        <p className="font-mono text-lead tracking-wider break-all text-ink" translate="no">
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
