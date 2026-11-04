import { Button } from '@arca/ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { download } from './download.js';
import { groupCode } from './enrollment.js';
import { textLinkClass } from './forms/text-link.js';
import { commonFailure, type CommonFailure } from './requests.js';

const partLabels = {
  account: {
    codeLabel: 'recoveryKit.codeLabel',
    keep: 'recoveryKit.keep',
    fileName: 'recoveryKit.fileName',
    fileText: 'recoveryKit.fileText',
    saved: 'recoveryKit.saved',
  },
  vault: {
    codeLabel: 'vault.kit.codeLabel',
    keep: 'vault.kit.keep',
    fileName: 'vault.kit.fileName',
    fileText: 'vault.kit.fileText',
    saved: 'vault.kit.saved',
  },
} as const;

/**
 * One part of the recovery kit, shown once (spec 0003, R6): the account recovery code or the vault
 * recovery secret, with print, a text file behind its warning, and a checkbox before `onSaved`,
 * which the screen that issued it supplies.
 */
export function RecoveryCodeSheet({
  code,
  onSaved,
  part = 'account',
}: {
  readonly code: string;
  readonly onSaved: () => Promise<void>;
  readonly part?: keyof typeof partLabels;
}) {
  const { t } = useTranslation();
  const labels = partLabels[part];
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
          {t(labels.codeLabel)}
        </p>
        <p className="font-mono text-lead tracking-wider break-all text-ink" translate="no">
          {grouped}
        </p>
      </div>
      <p>{t(labels.keep)}</p>
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
                download(t(labels.fileName), t(labels.fileText, { code: grouped }));
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
          <label htmlFor={savedId}>{t(labels.saved)}</label>
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
