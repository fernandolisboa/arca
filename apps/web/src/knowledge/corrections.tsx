import {
  ApiError,
  type CorrectionItem,
  type CorrectionRequests,
  type CorrectionSource,
  type ListedCorrectionSource,
  type VersionView,
  correctionLimits,
  correctionTargets,
  routes,
} from '@arca/api-contract/client';
import { Button, StatusChip, type StatusTone } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  use,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SubmitEvent,
} from 'react';
import { api, correctionRequestsQuery } from '../api.js';
import { filePicking } from '../platform.js';
import {
  correctionFileAccept,
  correctionFileType,
  fileExtensions,
} from './correction-file-type.js';
import { saveCorrectionFile, uploadCorrectionFile } from './correction-upload.js';
import { TextField } from '../forms/text-field.js';
import { textLinkClass } from '../forms/text-link.js';
import type { KnowledgeWords } from './words.js';

type ListedRequest = CorrectionRequests['requests'][number];

/** The version whose items the panel shows, and whether the viewer may file a request on them. */
interface Filing {
  readonly routeId: string;
  readonly number: number;
  readonly canFile: boolean;
  readonly words: KnowledgeWords;
}

const FilingContext = createContext<Filing | undefined>(undefined);

/** Gives the version's "Apontar erro" buttons their version, read once for the whole panel. */
export function CorrectionFiling({
  view,
  words,
  children,
}: {
  readonly view: VersionView;
  readonly words: KnowledgeWords;
  readonly children: ReactNode;
}) {
  const requests = useQuery(correctionRequestsQuery(view.routeId, view.number));
  const canFile = requests.data?.canFile === true;
  const filing = useMemo(
    () => ({ routeId: view.routeId, number: view.number, canFile, words }),
    [view.routeId, view.number, canFile, words],
  );
  return <FilingContext value={filing}>{children}</FilingContext>;
}

const textareaClass =
  'rounded-control border border-line bg-surface p-3 text-body text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

function TextArea({
  label,
  value,
  maxLength,
  rows,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly maxLength: number;
  readonly rows: number;
  readonly onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        maxLength={maxLength}
        value={value}
        className={textareaClass}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
      />
    </div>
  );
}

/** A file chosen for the request: uploading, uploaded with its upload's ID, or failed. */
interface FileDraft {
  readonly kind: 'file';
  readonly name: string;
  readonly state: 'sending' | 'ready' | 'failed';
  readonly uploadId?: string;
}

type Draft = { readonly id: number } & (
  { readonly kind: 'link'; url: string } | { readonly kind: 'text'; text: string } | FileDraft
);
type FormState = 'open' | 'sending' | 'limited' | 'corrected' | 'mismatch' | 'missing' | 'failed';

const failures = {
  limited: 'knowledge.corrections.tooMany',
  corrected: 'knowledge.corrections.alreadyCorrected',
  mismatch: 'knowledge.corrections.fileMismatch',
  missing: 'knowledge.corrections.fileMissing',
  failed: 'knowledge.corrections.sendFailure',
} as const;

/** The sources as the API takes them: blank ones and files not uploaded left out. */
function filledSources(drafts: readonly Draft[]): CorrectionSource[] {
  return drafts.flatMap((draft): CorrectionSource[] => {
    if (draft.kind === 'file') {
      return draft.uploadId === undefined ? [] : [{ kind: 'file', uploadId: draft.uploadId }];
    }
    if (draft.kind === 'link') {
      const url = draft.url.trim();
      return url === '' ? [] : [{ kind: 'link', url }];
    }
    const text = draft.text.trim();
    return text === '' ? [] : [{ kind: 'text', text }];
  });
}

function CorrectionForm({
  filing,
  item,
  close,
}: {
  readonly filing: Filing;
  readonly item: CorrectionItem;
  readonly close: (sent: boolean) => void;
}) {
  const { t } = filing.words;
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const nextIdRef = useRef(0);
  const add = (kind: 'link' | 'text') => {
    const id = nextIdRef.current++;
    setDrafts((current) => [
      ...current,
      kind === 'link' ? { id, kind, url: '' } : { id, kind, text: '' },
    ]);
  };
  const [state, setState] = useState<FormState>('open');
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formRef.current?.focus();
  }, []);
  const change = (draft: Draft) => {
    setDrafts((current) => current.map((old) => (old.id === draft.id ? draft : old)));
  };
  const remove = (id: number) => {
    setDrafts((current) => current.filter((old) => old.id !== id));
  };
  const [fileRefused, setFileRefused] = useState(false);
  const attach = (file: File) => {
    const mediaType = correctionFileType(file);
    setFileRefused(mediaType === undefined);
    if (mediaType === undefined) return;
    const id = nextIdRef.current++;
    const base = { id, kind: 'file', name: file.name } as const;
    setDrafts((current) => [...current, { ...base, state: 'sending' }]);
    uploadCorrectionFile(file, mediaType)
      .then((uploadId) => {
        change({ ...base, state: 'ready', uploadId });
      })
      .catch(() => {
        change({ ...base, state: 'failed' });
      });
  };
  const pickFile = () => {
    filePicking
      ?.pick({ accept: correctionFileAccept })
      .then(([file]) => {
        if (file !== undefined) attach(file);
      })
      .catch(() => {
        setFileRefused(true);
      });
  };
  const uploading = drafts.some((draft) => draft.kind === 'file' && draft.state === 'sending');
  const failedFile = drafts.some((draft) => draft.kind === 'file' && draft.state === 'failed');
  const send = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (note.trim() === '') return;
    setState('sending');
    try {
      await api.call(routes.fileCorrectionRequest, {
        routeId: filing.routeId,
        versionNumber: filing.number,
        item,
        note: note.trim(),
        sources: filledSources(drafts),
      });
      await queryClient.invalidateQueries(correctionRequestsQuery(filing.routeId, filing.number));
      close(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) setState('limited');
      else if (error instanceof ApiError && error.code === 'already_corrected')
        setState('corrected');
      else if (error instanceof ApiError && error.code === 'not_uploaded') setState('missing');
      else if (error instanceof ApiError && error.status === 409) setState('mismatch');
      else setState('failed');
    }
  };
  return (
    <form
      ref={formRef}
      tabIndex={-1}
      aria-label={t('knowledge.corrections.formTitle')}
      className="flex flex-col gap-3 rounded-control border border-line p-3"
      onSubmit={(event) => void send(event)}
    >
      <p className="text-small font-medium text-danger-ink">{t('knowledge.corrections.privacy')}</p>
      <TextArea
        label={t('knowledge.corrections.note')}
        value={note}
        maxLength={correctionLimits.note}
        rows={4}
        onChange={setNote}
      />
      {drafts.map((draft) =>
        draft.kind === 'file' ? (
          <div key={draft.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
            <span className="break-all font-medium">{draft.name}</span>
            <span
              role={draft.state === 'failed' ? 'alert' : 'status'}
              className={draft.state === 'failed' ? 'text-danger-ink' : 'text-muted'}
            >
              {t('knowledge.corrections.fileState', { state: draft.state })}
            </span>
            <button
              type="button"
              className={textLinkClass}
              onClick={() => {
                remove(draft.id);
              }}
            >
              {t('knowledge.corrections.removeFile')}
            </button>
          </div>
        ) : draft.kind === 'link' ? (
          <TextField
            key={draft.id}
            type="url"
            inputMode="url"
            label={t('knowledge.corrections.link')}
            hint={t('knowledge.corrections.linkHint')}
            value={draft.url}
            maxLength={correctionLimits.url}
            onChange={(event) => {
              change({ id: draft.id, kind: 'link', url: event.target.value });
            }}
          />
        ) : (
          <TextArea
            key={draft.id}
            label={t('knowledge.corrections.text')}
            value={draft.text}
            maxLength={correctionLimits.text}
            rows={6}
            onChange={(text) => {
              change({ id: draft.id, kind: 'text', text });
            }}
          />
        ),
      )}
      {drafts.length < correctionLimits.sources && (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <button
            type="button"
            className={textLinkClass}
            onClick={() => {
              add('link');
            }}
          >
            {t('knowledge.corrections.addLink')}
          </button>
          <button
            type="button"
            className={textLinkClass}
            onClick={() => {
              add('text');
            }}
          >
            {t('knowledge.corrections.addText')}
          </button>
          {filePicking !== undefined && (
            <button
              type="button"
              className={textLinkClass}
              onClick={() => {
                pickFile();
              }}
            >
              {t('knowledge.corrections.addFile')}
            </button>
          )}
        </div>
      )}
      {drafts.length < correctionLimits.sources && filePicking !== undefined && (
        <p className="text-small text-muted">{t('knowledge.corrections.fileHint')}</p>
      )}
      {fileRefused && (
        <p role="alert" className="text-small text-danger-ink">
          {t('knowledge.corrections.fileRefused')}
        </p>
      )}
      {state !== 'open' && state !== 'sending' && (
        <p role="alert" className="text-small text-danger-ink">
          {t(failures[state])}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          disabled={state === 'sending' || uploading || failedFile || note.trim() === ''}
        >
          {state === 'sending'
            ? t('knowledge.corrections.sending')
            : t('knowledge.corrections.send')}
        </Button>
        <button
          type="button"
          className={textLinkClass}
          onClick={() => {
            close(false);
          }}
        >
          {t('knowledge.corrections.cancel')}
        </button>
      </div>
    </form>
  );
}

/** "Apontar erro" on one item, the settings or the whole version; only an owner-list admin sees it. */
export function PointOutError({ item }: { readonly item: CorrectionItem }) {
  const filing = use(FilingContext);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  if (!filing?.canFile) return null;
  const { t } = filing.words;
  if (open) {
    return (
      <CorrectionForm
        filing={filing}
        item={item}
        close={(done) => {
          setOpen(false);
          setSent(done);
        }}
      />
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className={`${textLinkClass} self-start text-small`}
        onClick={() => {
          setSent(false);
          setOpen(true);
        }}
      >
        {t('knowledge.corrections.open')}
      </button>
      {sent && (
        <p role="status" className="text-small text-muted">
          {t('knowledge.corrections.sent')}
        </p>
      )}
    </div>
  );
}

const stateTones: Record<ListedRequest['state'], StatusTone> = {
  open: 'warn',
  taken: 'warn',
  answered: 'ok',
  closed: 'unknown',
};

/** The item's title in the version, or its key when the version no longer names it. */
function itemTitle(view: VersionView, { kind, key }: CorrectionItem): string {
  if (kind === 'version' || kind === 'settings') return '';
  return correctionTargets(view)[kind].find((target) => target.key === key)?.title ?? key ?? '';
}

/** A request's sources with keys: they are stored in order and never change. */
const keyedSources = (request: ListedRequest) =>
  request.sources.map((source, position) => ({
    key: `${request.id}:${String(position)}`,
    source,
    position,
  }));

/** A file source: its type and size, and a button that saves it on this device. */
function FileEntry({
  requestId,
  position,
  source,
  words,
}: {
  readonly requestId: string;
  readonly position: number;
  readonly source: Extract<ListedCorrectionSource, { kind: 'file' }>;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const [failed, setFailed] = useState(false);
  const extension = fileExtensions[source.mediaType];
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>
        {t('knowledge.corrections.fileSummary', {
          type: extension,
          size: new Intl.NumberFormat(words.language, {
            style: 'unit',
            unit: 'megabyte',
            maximumFractionDigits: 1,
          }).format(Math.max(source.size / 1_000_000, 0.1)),
        })}
      </span>
      <button
        type="button"
        className={textLinkClass}
        onClick={() => {
          setFailed(false);
          saveCorrectionFile(
            requestId,
            position,
            `${t('knowledge.corrections.fileName', { n: position + 1 })}.${extension}`,
          ).catch(() => {
            setFailed(true);
          });
        }}
      >
        {t('knowledge.corrections.download')}
      </button>
      {failed && (
        <span role="alert" className="text-danger-ink">
          {t('knowledge.corrections.downloadFailure')}
        </span>
      )}
    </span>
  );
}

function RequestEntry({
  request,
  view,
  words,
}: {
  readonly request: ListedRequest;
  readonly view: VersionView;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);
  const headingId = useId();
  return (
    <li className="flex flex-col gap-2 rounded-control border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip
          tone={stateTones[request.state]}
          label={t('knowledge.corrections.state', { state: request.state })}
        />
        <p id={headingId} className="font-medium">
          {t('knowledge.corrections.item', {
            kind: request.item.kind,
            title: itemTitle(view, request.item),
          })}
        </p>
      </div>
      <p className="text-small text-muted">
        {t('knowledge.corrections.filedAt', {
          date: new Intl.DateTimeFormat(words.language, { dateStyle: 'long' }).format(
            new Date(request.createdAt),
          ),
        })}
      </p>
      {request.note === null ? (
        <p className="text-small text-muted">{t('knowledge.corrections.erased')}</p>
      ) : (
        <p className="whitespace-pre-wrap">{request.note}</p>
      )}
      {request.sources.length > 0 && (
        <ul className="flex flex-col gap-2 text-small">
          {keyedSources(request).map(({ key, source, position }) => (
            <li key={key} className="flex flex-col gap-1">
              <span className="text-muted">
                {t('knowledge.corrections.sourceKind', { kind: source.kind })}
              </span>
              {source.kind === 'link' && (
                // Plain text, never a link: the admin reads the full address before opening it.
                <span className="font-mono break-all">{source.url}</span>
              )}
              {source.kind === 'text' && (
                <span className="line-clamp-6 whitespace-pre-wrap">{source.text}</span>
              )}
              {source.kind === 'file' && (
                <FileEntry
                  requestId={request.id}
                  position={position}
                  source={source}
                  words={words}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {failed && (
        <p role="alert" className="text-small text-danger-ink">
          {t('knowledge.corrections.closeFailure')}
        </p>
      )}
      {request.state !== 'closed' && (
        <button
          type="button"
          aria-describedby={headingId}
          className={`${textLinkClass} self-start text-small`}
          onClick={() => {
            setFailed(false);
            api
              .call(routes.closeCorrectionRequest, { id: request.id })
              .then(() =>
                queryClient.invalidateQueries(correctionRequestsQuery(view.routeId, view.number)),
              )
              .catch(() => {
                setFailed(true);
              });
          }}
        >
          {t('knowledge.corrections.close')}
        </button>
      )}
    </li>
  );
}

/** The version's correction requests and their states (ADR-0029); nothing when it has none. */
export function CorrectionsSection({
  view,
  words,
}: {
  readonly view: VersionView;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const requests = useQuery(correctionRequestsQuery(view.routeId, view.number));
  const title = t('knowledge.corrections.title');
  if (requests.isError) {
    return <p className="text-small text-muted">{t('knowledge.corrections.loadFailure')}</p>;
  }
  const listed = requests.data?.requests ?? [];
  if (listed.length === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h4 className="font-medium">{title}</h4>
      <ul className="flex flex-col gap-3">
        {listed.map((request) => (
          <RequestEntry key={request.id} request={request} view={view} words={words} />
        ))}
      </ul>
    </section>
  );
}
