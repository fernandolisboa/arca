import { Button, Icon, iconButtonClass } from '@arca/ui';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { download } from './download.js';
import { groupCode } from './enrollment.js';
import { textLinkClass } from './forms/text-link.js';
import { commonFailure, type CommonFailure } from './requests.js';

const partLabels = {
  account: {
    codeLabel: 'recoveryKit.codeLabel',
    copy: 'recoveryKit.copy',
    keep: 'recoveryKit.keep',
    fileName: 'recoveryKit.fileName',
    fileText: 'recoveryKit.fileText',
    saved: 'recoveryKit.saved',
  },
  vault: {
    codeLabel: 'vault.kit.codeLabel',
    copy: 'vault.kit.copy',
    keep: 'vault.kit.keep',
    fileName: 'vault.kit.fileName',
    fileText: 'vault.kit.fileText',
    saved: 'vault.kit.saved',
  },
} as const;

type CopyState = 'idle' | 'copied' | 'failed';

/** Copies the text to the clipboard; `copied` falls back to `idle` after two seconds. */
function useCopy(text: string) {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state !== 'copied') return;
    const timer = setTimeout(() => {
      setState('idle');
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  const copy = () => {
    // Inside the promise, so a browser without the clipboard API lands in `failed` too.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => {
          setState('copied');
        },
        () => {
          setState('failed');
        },
      );
  };

  return { state, copy };
}

/**
 * One part of the recovery kit, shown once (spec 0003, R6): the account recovery code or the vault
 * recovery secret, with copy, print, a text file behind its warning, and a checkbox before `onSaved`,
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
  const clipboard = useCopy(grouped);
  const copyStatus = {
    idle: '',
    copied: t('recoveryKit.copied'),
    failed: t('recoveryKit.copyFailure'),
  }[clipboard.state];

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
        <div className="flex items-center justify-between gap-2">
          <p
            className="min-w-0 font-mono text-lead tracking-wider break-all text-ink"
            translate="no"
          >
            {grouped}
          </p>
          <button
            type="button"
            aria-label={t(labels.copy)}
            title={t(labels.copy)}
            onClick={clipboard.copy}
            className={`${iconButtonClass} text-muted hover:bg-soft hover:text-ink print:hidden`}
          >
            <Icon name={clipboard.state === 'copied' ? 'check' : 'copy'} />
          </button>
        </div>
        <span
          role="status"
          className={clipboard.state === 'failed' ? 'text-muted print:hidden' : 'sr-only'}
        >
          {copyStatus}
        </span>
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
