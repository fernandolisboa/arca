import {
  ApiError,
  type CorrectionItem,
  type CorrectionRequests,
  type CorrectionSource,
  type VersionView,
  correctionLimits,
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
import { TextField } from '../forms/text-field.js';
import { textLinkClass } from '../forms/text-link.js';
import type { KnowledgeWords } from './words.js';

type Request = CorrectionRequests['requests'][number];
type Kind = CorrectionItem['kind'];

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

type Draft = { readonly id: number } & (
  { readonly kind: 'link'; url: string } | { readonly kind: 'text'; text: string }
);
type State = 'open' | 'sending' | 'limited' | 'failed';

/** The sources as the API takes them: blank ones left out. */
function filledSources(drafts: readonly Draft[]): CorrectionSource[] {
  return drafts.flatMap((draft): CorrectionSource[] => {
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
  const add = (kind: Draft['kind']) => {
    const id = nextIdRef.current++;
    setDrafts((current) => [
      ...current,
      kind === 'link' ? { id, kind, url: '' } : { id, kind, text: '' },
    ]);
  };
  const [state, setState] = useState<State>('open');
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formRef.current?.focus();
  }, []);
  const change = (draft: Draft) => {
    setDrafts((current) => current.map((old) => (old.id === draft.id ? draft : old)));
  };
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
      setState(error instanceof ApiError && error.status === 429 ? 'limited' : 'failed');
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
        draft.kind === 'link' ? (
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
        </div>
      )}
      {(state === 'limited' || state === 'failed') && (
        <p role="alert" className="text-small text-danger-ink">
          {t(
            state === 'limited'
              ? 'knowledge.corrections.tooMany'
              : 'knowledge.corrections.sendFailure',
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={state === 'sending' || note.trim() === ''}>
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

const stateTones: Record<Request['state'], StatusTone> = {
  open: 'warn',
  taken: 'warn',
  answered: 'ok',
  closed: 'unknown',
};

/** The item's title in the version, or its key when the version no longer names it. */
function itemTitle(view: VersionView, { kind, key }: CorrectionItem): string | null {
  const titled: Partial<Record<Kind, readonly { id: string; title: string }[]>> = {
    requirement: view.requirements,
    assessment: view.assessments,
    dependent: view.dependents,
    cost: view.costs,
    duration: view.durations,
  };
  if (kind === 'countrySet') {
    return view.countrySets.find((set) => `${set.id}/${String(set.number)}` === key)?.title ?? key;
  }
  return titled[kind]?.find(({ id }) => id === key)?.title ?? key;
}

/** A request's sources with keys: they are stored in order and never change. */
const keyedSources = (request: Request) =>
  request.sources.map((source, position) => ({ key: `${request.id}:${String(position)}`, source }));

function RequestEntry({
  request,
  view,
  words,
}: {
  readonly request: Request;
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
            title: itemTitle(view, request.item) ?? '',
          })}
        </p>
      </div>
      <p className="text-small text-muted">
        {t('knowledge.corrections.filedAt', { date: words.date(request.createdAt.slice(0, 10)) })}
      </p>
      <p className="whitespace-pre-wrap">{request.note}</p>
      {request.sources.length > 0 && (
        <ul className="flex flex-col gap-2 text-small">
          {keyedSources(request).map(({ key, source }) => (
            <li key={key} className="flex flex-col gap-1">
              <span className="text-muted">
                {t('knowledge.corrections.sourceKind', { kind: source.kind })}
              </span>
              {source.kind === 'link' ? (
                // Plain text, never a link: the admin reads the full address before opening it.
                <span className="font-mono break-all">{source.url}</span>
              ) : (
                <span className="line-clamp-6 whitespace-pre-wrap">{source.text}</span>
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
