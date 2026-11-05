import { ApiError, documentQuota, maxDocumentBytes } from '@arca/api-contract/client';
import { Button } from '@arca/ui';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addDocument,
  deleteDocument,
  DocumentNotOpened,
  documentsQuery,
  DocumentTooLarge,
  ReplacementRefused,
  saveDocument,
  type OpenedDocument,
} from './documents.js';
import { dangerLinkClass, textLinkClass } from './forms/text-link.js';
import { filePicking, passkeys } from './platform.js';
import { commonFailure, type CommonFailure } from './requests.js';
import { SharePanel } from './share-panel.js';
import {
  confirmSharingState,
  shareDocument,
  sharingQuery,
  SharingStateInvalid,
} from './sharing.js';
import type { Sharing } from './share-recipients.js';
import { useDateFormat } from './use-date-format.js';
import type { UnlockedVault } from './vault-session.js';

type Done = 'added' | 'saved' | 'deleted' | 'shared' | 'confirmed';
type DocumentFailure =
  | CommonFailure
  | 'too_large'
  | 'quota'
  | 'changed'
  | 'not_opened'
  | 'unconfirmed'
  | 'not_shared'
  | 'sharing_invalid';

const documentApiFailures: Partial<Record<string, DocumentFailure>> = {
  document_quota: 'quota',
  account_unconfirmed: 'unconfirmed',
  // The vault was reset or set up again elsewhere since this device opened it.
  not_found: 'changed',
  // Another device changed the vault or the sharing state since this one read it.
  vault_changed: 'changed',
  sharing_state_changed: 'changed',
  // A person lost their link since the list was read.
  not_linked: 'not_shared',
};

function documentFailure(error: unknown): DocumentFailure {
  if (error instanceof DocumentTooLarge) return 'too_large';
  if (error instanceof DocumentNotOpened) return 'not_opened';
  if (error instanceof ReplacementRefused) return 'not_shared';
  if (error instanceof SharingStateInvalid) return 'sharing_invalid';
  return commonFailure(error, (apiError: ApiError) => documentApiFailures[apiError.code]);
}

const sizeUnits = [
  ['gigabyte', 1024 ** 3],
  ['megabyte', 1024 ** 2],
  ['kilobyte', 1024],
] as const;

/** Sizes in binary units, as the limits are set, so a file at the limit reads as the limit. */
function useSize() {
  const { i18n } = useTranslation();
  return (bytes: number) => {
    const [unit, scale] = sizeUnits.find(([, of]) => bytes >= of) ?? sizeUnits[2];
    return new Intl.NumberFormat(i18n.language, {
      style: 'unit',
      unit,
      maximumFractionDigits: 1,
    }).format(Math.max(bytes / scale, 0.1));
  };
}

/** The open vault's documents (spec 0005, R4): added, saved and deleted on this device. */
export function DocumentsSection({ vault }: { readonly vault: UnlockedVault }) {
  const { t } = useTranslation();
  const size = useSize();
  const queryClient = useQueryClient();
  const query = documentsQuery(vault);
  const documents = useQuery(query);
  const sharingOptions = sharingQuery(vault);
  const sharing = useQuery(sharingOptions);
  const [waiting, setWaiting] = useState(false);
  const [outcome, setOutcome] = useState<{ done: Done } | { failure: DocumentFailure }>();
  const statusRef = useRef<HTMLParagraphElement>(null);

  const change = (run: () => Promise<boolean>, done: Done, refresh: boolean) => {
    setOutcome(undefined);
    setWaiting(true);
    void (async () => {
      let changed: boolean;
      try {
        changed = await run();
        if (changed) setOutcome({ done });
      } catch (error) {
        // A failed step can follow one that stored, so the lists are read again either way.
        changed = true;
        setOutcome({ failure: documentFailure(error) });
      }
      if (refresh && changed) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: query.queryKey }),
          queryClient.invalidateQueries({ queryKey: sharingOptions.queryKey }),
        ]);
      }
      setWaiting(false);
      // The control that had focus may leave with its row, so focus moves to the result.
      statusRef.current?.focus();
    })();
  };

  const add = () => {
    if (filePicking === undefined) return;
    const picker = filePicking;
    change(
      async () => {
        const [file] = await picker.pick();
        if (file === undefined) return false;
        await addDocument(passkeys, vault, file, t('vault.documents.fallbackName'));
        return true;
      },
      'added',
      true,
    );
  };

  const message = waiting
    ? t('vault.documents.working')
    : outcome === undefined
      ? ''
      : 'done' in outcome
        ? t('vault.documents.done', { done: outcome.done })
        : t('vault.documents.failure', {
            reason: outcome.failure,
            maxSize: size(maxDocumentBytes),
            maxDocuments: documentQuota.documents,
            maxBytes: size(documentQuota.bytes),
          });

  const documentNames = names(documents.data ?? []);

  return (
    <section aria-labelledby="documents-title" className="flex w-full flex-col items-start gap-3">
      <h3 id="documents-title" className="text-title font-medium">
        {t('vault.documents.title')}
      </h3>
      {filePicking === undefined ? (
        <p className="text-muted">{t('vault.documents.cannotPick')}</p>
      ) : (
        <Button disabled={waiting} aria-busy={waiting} onClick={add}>
          {t('vault.documents.add')}
        </Button>
      )}
      <p
        ref={statusRef}
        role="status"
        tabIndex={-1}
        className={outcome !== undefined && 'done' in outcome ? 'text-ok-ink' : 'text-ink'}
      >
        {message}
      </p>
      {documents.isError && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-ink">{t('vault.documents.listFailure')}</p>
          <Button
            disabled={documents.isFetching}
            aria-busy={documents.isFetching}
            onClick={() => void documents.refetch()}
          >
            {t('vault.documents.retry')}
          </Button>
        </div>
      )}
      {documents.isSuccess &&
        (documents.data.length === 0 ? (
          <p className="text-muted">{t('vault.documents.empty')}</p>
        ) : (
          <ul aria-label={t('vault.documents.title')} className="flex w-full flex-col gap-3">
            {documents.data.map((opened) => (
              <DocumentRow
                key={opened.document.id}
                opened={opened}
                names={documentNames}
                own={opened.document.ownerId === vault.accountId}
                disabled={waiting}
                onSave={() => {
                  change(
                    async () => {
                      await saveDocument(passkeys, vault, opened);
                      return true;
                    },
                    'saved',
                    false,
                  );
                }}
                sharing={sharing}
                onShare={(chosen, accepted) => {
                  if (sharing.data === undefined) return;
                  const current = sharing.data;
                  change(
                    async () => {
                      await shareDocument(passkeys, vault, current, opened, chosen, accepted);
                      return true;
                    },
                    'shared',
                    true,
                  );
                }}
                onConfirmState={() => {
                  if (sharing.data === undefined) return;
                  const { view } = sharing.data;
                  change(
                    async () => {
                      await confirmSharingState(passkeys, vault, view);
                      return true;
                    },
                    'confirmed',
                    true,
                  );
                }}
                onDelete={() => {
                  change(
                    async () => {
                      await deleteDocument(passkeys, opened.document.id);
                      return true;
                    },
                    'deleted',
                    true,
                  );
                }}
              />
            ))}
          </ul>
        ))}
    </section>
  );
}

/** Each opened document's name by ID, for the rolled-back sharing list. */
const names = (opened: readonly OpenedDocument[]): ReadonlyMap<string, string> =>
  new Map(
    opened.flatMap(({ document, label }) =>
      label === undefined ? [] : [[document.id, label.name] as const],
    ),
  );

function DocumentRow({
  opened,
  names,
  own,
  disabled,
  sharing,
  onSave,
  onShare,
  onConfirmState,
  onDelete,
}: {
  readonly opened: OpenedDocument;
  readonly names: ReadonlyMap<string, string>;
  readonly own: boolean;
  readonly disabled: boolean;
  readonly sharing: UseQueryResult<Sharing>;
  readonly onSave: () => void;
  readonly onShare: (chosen: ReadonlySet<string>, accepted: ReadonlySet<string>) => void;
  readonly onConfirmState: () => void;
  readonly onDelete: () => void;
}) {
  const { document, label } = opened;
  const { t } = useTranslation();
  const when = useDateFormat();
  const size = useSize();
  const nameId = useId();
  const panelId = useId();
  const [sharingOpen, setSharingOpen] = useState(false);
  return (
    <li className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
      <p id={nameId} className="font-medium break-words">
        {label?.name ?? t('vault.documents.unnamed')}
      </p>
      <p className="text-small text-muted">
        {t('vault.documents.details', {
          size: size(document.size),
          created: when.format(new Date(document.createdAt)),
        })}
      </p>
      {own ? (
        document.sharedWith.length > 0 && (
          <p className="text-small text-muted">
            {t('vault.documents.sharedWith', { count: document.sharedWith.length })}
          </p>
        )
      ) : (
        <p className="text-small text-muted">{t('vault.documents.sharedWithYou')}</p>
      )}
      <div className="flex flex-wrap gap-x-6">
        {label !== undefined && (
          <button
            type="button"
            disabled={disabled}
            aria-describedby={nameId}
            className={textLinkClass}
            onClick={onSave}
          >
            {t('vault.documents.save')}
          </button>
        )}
        {own && label !== undefined && (
          <button
            type="button"
            disabled={disabled}
            aria-describedby={nameId}
            aria-expanded={sharingOpen}
            aria-controls={sharingOpen ? panelId : undefined}
            className={textLinkClass}
            onClick={() => {
              setSharingOpen((open) => !open);
            }}
          >
            {t('vault.documents.share.open')}
          </button>
        )}
        {own && (
          <button
            type="button"
            disabled={disabled}
            aria-describedby={nameId}
            className={dangerLinkClass}
            onClick={onDelete}
          >
            {t('vault.documents.delete')}
          </button>
        )}
      </div>
      {sharingOpen && (
        <SharePanel
          id={panelId}
          opened={opened}
          name={label?.name ?? t('vault.documents.unnamed')}
          names={names}
          sharing={sharing}
          disabled={disabled}
          onShare={onShare}
          onConfirmState={onConfirmState}
          onClose={() => {
            setSharingOpen(false);
          }}
        />
      )}
    </li>
  );
}
