import { type RouteRequests, correctionLimits, routes } from '@arca/api-contract/client';
import { Button } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { api, routeRequestsQuery } from '../api.js';
import { SelectField } from '../forms/select-field.js';
import { TextField } from '../forms/text-field.js';
import { textLinkClass } from '../forms/text-link.js';
import { filePicking } from '../platform.js';
import { correctionFileAccept, correctionFileType } from './correction-file-type.js';
import { uploadCorrectionFile } from './correction-upload.js';
import { AnswerBox, MarkedText, RequestCard, TextArea, filingFailure } from './corrections.js';
import {
  type PageDraft,
  type PageFile,
  type PassageDraft,
  type PassageTopic,
  type RouteRequestDraft,
  type RouteRequestStep,
  canAddSource,
  pageAddresses,
  passageTopics,
  routeRequestSources,
  routeRequestSteps,
  stepReady,
} from './route-request-draft.js';
import type { KnowledgeWords } from './words.js';

type ListedRouteRequest = RouteRequests['requests'][number];
type SendState = 'open' | 'sending' | 'limited' | 'mismatch' | 'missing' | 'failed';

const failures = {
  limited: 'knowledge.corrections.tooMany',
  mismatch: 'knowledge.corrections.fileMismatch',
  missing: 'knowledge.corrections.fileMissing',
  failed: 'knowledge.routeRequests.sendFailure',
} as const;

const emptyDraft: RouteRequestDraft = { countryCode: '', note: '', pages: [], passages: [] };

/** One official page in the wizard: its address and the PDF saved from it. */
function PageFields({
  page,
  words,
  onAddress,
  onPick,
  onRemove,
}: {
  readonly page: PageDraft;
  readonly words: KnowledgeWords;
  readonly onAddress: (url: string) => void;
  readonly onPick: () => void;
  readonly onRemove: () => void;
}) {
  const { t } = words;
  return (
    <li className="flex flex-col gap-2 rounded-control border border-line p-3">
      <TextField
        type="url"
        inputMode="url"
        label={t('knowledge.routeRequests.pageAddress')}
        hint={t('knowledge.corrections.linkHint')}
        value={page.url}
        maxLength={correctionLimits.url}
        onChange={(event) => {
          onAddress(event.target.value);
        }}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
        {page.file === undefined ? (
          filePicking !== undefined && (
            <button type="button" className={textLinkClass} onClick={onPick}>
              {t('knowledge.routeRequests.attachCopy')}
            </button>
          )
        ) : (
          <>
            <span className="break-all font-medium">{page.file.name}</span>
            <span
              role={page.file.state === 'failed' ? 'alert' : 'status'}
              className={page.file.state === 'failed' ? 'text-danger-ink' : 'text-muted'}
            >
              {t('knowledge.corrections.fileState', { state: page.file.state })}
            </span>
          </>
        )}
        <button type="button" className={textLinkClass} onClick={onRemove}>
          {t('knowledge.routeRequests.removePage')}
        </button>
      </div>
    </li>
  );
}

/** The passages pasted for one topic, each with the page it came from. */
function TopicPassages({
  topic,
  draft,
  words,
  onChange,
  onAdd,
  onRemove,
}: {
  readonly topic: PassageTopic;
  readonly draft: RouteRequestDraft;
  readonly words: KnowledgeWords;
  readonly onChange: (passage: PassageDraft) => void;
  readonly onAdd: () => void;
  readonly onRemove: (id: number) => void;
}) {
  const { t } = words;
  const headingId = useId();
  const addresses = pageAddresses(draft.pages);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h5 id={headingId} className="font-medium">
        {t('knowledge.routeRequests.topic', { topic })}
      </h5>
      <p className="text-small text-muted">{t('knowledge.routeRequests.topicHint', { topic })}</p>
      {draft.passages
        .filter((passage) => passage.topic === topic)
        .map((passage) => (
          <div
            key={passage.id}
            className="flex flex-col gap-2 rounded-control border border-line p-3"
          >
            <TextArea
              label={t('knowledge.routeRequests.passage')}
              value={passage.text}
              maxLength={correctionLimits.text}
              rows={5}
              onChange={(text) => {
                onChange({ ...passage, text });
              }}
            />
            {addresses.length > 0 && (
              <SelectField
                label={t('knowledge.routeRequests.passagePage')}
                value={passage.pageUrl}
                placeholder={t('knowledge.routeRequests.noPage')}
                options={addresses.map((url) => ({ value: url, label: url }))}
                onChange={(pageUrl) => {
                  onChange({ ...passage, pageUrl });
                }}
              />
            )}
            <button
              type="button"
              className={`${textLinkClass} self-start text-small`}
              onClick={() => {
                onRemove(passage.id);
              }}
            >
              {t('knowledge.routeRequests.removePassage')}
            </button>
          </div>
        ))}
      {canAddSource(draft) && (
        <button type="button" className={`${textLinkClass} self-start`} onClick={onAdd}>
          {t('knowledge.routeRequests.addPassage')}
        </button>
      )}
    </section>
  );
}

/**
 * "Pedir regra nova" (ADR-0029, new routes): a guide in four steps for a route the catalog lacks,
 * usually on a site no session can read: the country and route, the official pages saved as PDF
 * with their addresses, the passages that carry each rule, then a review before sending.
 */
function RouteRequestWizard({
  countries,
  words,
  close,
}: {
  readonly countries: RouteRequests['countries'];
  readonly words: KnowledgeWords;
  readonly close: (sent: boolean) => void;
}) {
  const { t } = words;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<RouteRequestDraft>(emptyDraft);
  const [stepIndex, setStepIndex] = useState(0);
  const [state, setState] = useState<SendState>('open');
  const [fileRefused, setFileRefused] = useState(false);
  const nextIdRef = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const step: RouteRequestStep = routeRequestSteps[stepIndex] ?? 'route';
  useEffect(() => {
    headingRef.current?.focus();
  }, [stepIndex]);
  const nextId = () => nextIdRef.current++;
  const changePage = (id: number, change: Partial<Pick<PageDraft, 'url' | 'file'>>) => {
    setDraft((current) => ({
      ...current,
      pages: current.pages.map((page) => (page.id === id ? { ...page, ...change } : page)),
    }));
  };
  /** Merges into a page's file as it then stands, so an upload ending never undoes an edit. */
  const settleFile = (id: number, settled: Partial<PageFile>) => {
    setDraft((current) => ({
      ...current,
      pages: current.pages.map((page) =>
        page.id === id && page.file !== undefined
          ? { ...page, file: { ...page.file, ...settled } }
          : page,
      ),
    }));
  };
  const pickCopy = (id: number) => {
    filePicking
      ?.pick({ accept: correctionFileAccept })
      .then(([file]) => {
        if (file === undefined) return;
        const mediaType = correctionFileType(file);
        setFileRefused(mediaType === undefined);
        if (mediaType === undefined) return;
        changePage(id, { file: { name: file.name, state: 'sending' } });
        uploadCorrectionFile(file, mediaType)
          .then((uploadId) => {
            settleFile(id, { state: 'ready', uploadId });
          })
          .catch(() => {
            settleFile(id, { state: 'failed' });
          });
      })
      .catch(() => {
        setFileRefused(true);
      });
  };
  const selected = countries.find(({ code }) => code === draft.countryCode);
  const countryName =
    draft.countryCode === '' ? '' : words.country(draft.countryCode.toUpperCase());
  const send = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step !== 'review') {
      if (stepReady(step, draft)) setStepIndex(stepIndex + 1);
      return;
    }
    setState('sending');
    try {
      await api.call(routes.fileRouteRequest, {
        countryCode: draft.countryCode,
        note: draft.note.trim(),
        sources: routeRequestSources(draft),
      });
      await queryClient.invalidateQueries(routeRequestsQuery);
      close(true);
    } catch (error) {
      const failure = filingFailure(error);
      setState(failure === 'corrected' ? 'failed' : failure);
    }
  };
  const sources = routeRequestSources(draft);
  return (
    <form
      aria-label={t('knowledge.routeRequests.formTitle')}
      className="flex flex-col gap-4 rounded-control border border-line p-3"
      onSubmit={(event) => void send(event)}
    >
      <div className="flex flex-col gap-1">
        <p className="text-small text-muted">
          {t('knowledge.routeRequests.stepCount', {
            n: stepIndex + 1,
            total: routeRequestSteps.length,
          })}
        </p>
        <h4 ref={headingRef} tabIndex={-1} className="font-medium focus:outline-none">
          {t('knowledge.routeRequests.stepTitle', { step })}
        </h4>
      </div>
      {step !== 'review' && (
        <p className="text-small font-medium text-danger-ink">
          {t('knowledge.corrections.privacy')}
        </p>
      )}
      {step === 'route' && (
        <>
          <p className="text-small text-muted">{t('knowledge.routeRequests.routeLead')}</p>
          <SelectField
            label={t('knowledge.routeRequests.country')}
            value={draft.countryCode}
            placeholder={t('knowledge.routeRequests.pickCountry')}
            options={countries
              .map(({ code }) => ({ value: code, label: words.country(code.toUpperCase()) }))
              .toSorted((left, right) => left.label.localeCompare(right.label, words.language))}
            onChange={(countryCode) => {
              setDraft((current) => ({ ...current, countryCode }));
            }}
          />
          <TextArea
            label={t('knowledge.routeRequests.note')}
            value={draft.note}
            maxLength={correctionLimits.note}
            rows={4}
            onChange={(note) => {
              setDraft((current) => ({ ...current, note }));
            }}
          />
        </>
      )}
      {step === 'pages' && (
        <>
          <p className="text-small">{t('knowledge.routeRequests.pagesLead')}</p>
          <p className="text-small text-muted">
            {selected === undefined || selected.officialHosts.length === 0
              ? t('knowledge.routeRequests.noKnownHosts', { country: countryName })
              : t('knowledge.routeRequests.knownHosts', {
                  country: countryName,
                  hosts: words.list(selected.officialHosts),
                })}
          </p>
          <ol className="flex flex-col gap-3">
            {draft.pages.map((page) => (
              <PageFields
                key={page.id}
                page={page}
                words={words}
                onAddress={(url) => {
                  changePage(page.id, { url });
                }}
                onPick={() => {
                  pickCopy(page.id);
                }}
                onRemove={() => {
                  setDraft((current) => ({
                    ...current,
                    pages: current.pages.filter(({ id }) => id !== page.id),
                  }));
                }}
              />
            ))}
          </ol>
          {canAddSource(draft) && (
            <button
              type="button"
              className={`${textLinkClass} self-start`}
              onClick={() => {
                setDraft((current) => ({
                  ...current,
                  pages: [...current.pages, { id: nextId(), url: '' }],
                }));
              }}
            >
              {t('knowledge.routeRequests.addPage', { first: draft.pages.length === 0 })}
            </button>
          )}
          {filePicking !== undefined && (
            <p className="text-small text-muted">{t('knowledge.routeRequests.copyHint')}</p>
          )}
          {fileRefused && (
            <p role="alert" className="text-small text-danger-ink">
              {t('knowledge.corrections.fileRefused')}
            </p>
          )}
        </>
      )}
      {step === 'passages' && (
        <>
          <p className="text-small">{t('knowledge.routeRequests.passagesLead')}</p>
          {passageTopics.map((topic) => (
            <TopicPassages
              key={topic}
              topic={topic}
              draft={draft}
              words={words}
              onChange={(passage) => {
                setDraft((current) => ({
                  ...current,
                  passages: current.passages.map((old) => (old.id === passage.id ? passage : old)),
                }));
              }}
              onAdd={() => {
                setDraft((current) => ({
                  ...current,
                  passages: [...current.passages, { id: nextId(), topic, text: '', pageUrl: '' }],
                }));
              }}
              onRemove={(id) => {
                setDraft((current) => ({
                  ...current,
                  passages: current.passages.filter((passage) => passage.id !== id),
                }));
              }}
            />
          ))}
        </>
      )}
      {step === 'review' && (
        <div className="flex flex-col gap-2 text-small">
          <p>{t('knowledge.routeRequests.reviewCountry', { country: countryName })}</p>
          <p className="whitespace-pre-wrap">{draft.note.trim()}</p>
          <p>
            {t('knowledge.routeRequests.reviewCounts', {
              pages: sources.filter(({ kind }) => kind !== 'text').length,
              copies: sources.filter(({ kind }) => kind === 'file').length,
              passages: sources.filter(({ kind }) => kind === 'text').length,
            })}
          </p>
          <p className="text-muted">{t('knowledge.routeRequests.reviewNext')}</p>
        </div>
      )}
      {state !== 'open' && state !== 'sending' && (
        <p role="alert" className="text-small text-danger-ink">
          {t(failures[state])}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={state === 'sending' || !stepReady(step, draft)}>
          {step !== 'review'
            ? t('knowledge.routeRequests.next')
            : state === 'sending'
              ? t('knowledge.corrections.sending')
              : t('knowledge.corrections.send')}
        </Button>
        {stepIndex > 0 && (
          <button
            type="button"
            className={textLinkClass}
            onClick={() => {
              setStepIndex(stepIndex - 1);
            }}
          >
            {t('knowledge.routeRequests.back')}
          </button>
        )}
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

function RouteRequestEntry({
  request,
  words,
  onOpenVersion,
}: {
  readonly request: ListedRouteRequest;
  readonly words: KnowledgeWords;
  readonly onOpenVersion: (routeId: string, number: number) => void;
}) {
  const { t } = words;
  const { answer } = request;
  return (
    <RequestCard
      request={request}
      heading={words.country(request.countryCode.toUpperCase())}
      answer={
        answer === null ? null : answer.kind === 'no_change' ? (
          <AnswerBox title={t('knowledge.routeRequests.answerNoRoute')}>
            <MarkedText text={answer.explanation} />
          </AnswerBox>
        ) : (
          <AnswerBox title={t('knowledge.routeRequests.answerRoute')}>
            <button
              type="button"
              className={textLinkClass}
              onClick={() => {
                onOpenVersion(answer.routeId, answer.number);
              }}
            >
              {t('knowledge.routeRequests.openRoute')}
            </button>
          </AnswerBox>
        )
      }
      reload={routeRequestsQuery.queryKey}
      words={words}
    />
  );
}

/**
 * Requests for new routes on the activation screen (ADR-0029, new routes): an owner-list admin
 * opens the guide here, and any admin follows each request until its version is decided.
 */
export function RouteRequestsSection({
  words,
  onOpenVersion,
}: {
  readonly words: KnowledgeWords;
  readonly onOpenVersion: (routeId: string, number: number) => void;
}) {
  const { t } = words;
  const requests = useQuery(routeRequestsQuery);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const title = t('knowledge.routeRequests.title');
  if (requests.isError) {
    return <p className="text-small text-muted">{t('knowledge.routeRequests.loadFailure')}</p>;
  }
  if (requests.data === undefined) return null;
  const { canFile, countries } = requests.data;
  const listed = requests.data.requests;
  if (!canFile && listed.length === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h3 className="font-medium">{title}</h3>
      {canFile && !open && (
        <>
          <p className="text-small text-muted">{t('knowledge.routeRequests.lead')}</p>
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                setSent(false);
                setOpen(true);
              }}
            >
              {t('knowledge.routeRequests.open')}
            </Button>
          </div>
        </>
      )}
      {sent && (
        <p role="status" className="text-small text-muted">
          {t('knowledge.routeRequests.sent')}
        </p>
      )}
      {open && (
        <RouteRequestWizard
          countries={countries}
          words={words}
          close={(done) => {
            setOpen(false);
            setSent(done);
          }}
        />
      )}
      {listed.length > 0 && (
        <ul className="flex flex-col gap-3">
          {listed.map((request) => (
            <RouteRequestEntry
              key={request.id}
              request={request}
              words={words}
              onOpenVersion={onOpenVersion}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
