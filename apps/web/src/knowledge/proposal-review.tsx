import {
  type ApiError,
  type EditItemResponse,
  type ProposedDomainList,
  type ReviewItem,
  type VersionReview,
  type VersionView,
  maxItemJsonLength,
  routes,
} from '@arca/api-contract/client';
import { Button, StatusChip } from '@arca/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { use, useId, useState } from 'react';
import { api, knowledgeVersionsQuery, versionReviewQuery } from '../api.js';
import { SelectField } from '../forms/select-field.js';
import { TextField } from '../forms/text-field.js';
import { textLinkClass } from '../forms/text-link.js';
import { commonFailure, reach } from '../requests.js';
import { OpenRouteVersionContext, TextArea } from './corrections.js';
import { Decision, decideOfficialDomains } from './decision.js';
import { card } from './review-parts.js';
import { stateTone } from './state-tone.js';
import type { KnowledgeWords } from './words.js';

const lists = ['confirmed', 'divergent', 'unconfirmed'] as const;

const editCodes = ['update_live', 'version_taken', 'already_rejected', 'not_found'] as const;
const isEditCode = (code: string): code is (typeof editCodes)[number] =>
  (editCodes as readonly string[]).includes(code);
const editFailure = (error: unknown) =>
  commonFailure(error, ({ code }: ApiError) => (isEditCode(code) ? code : undefined));

/** One item with its official pages and the passages code found on them, as plain text. */
function ItemCard({
  item,
  onEdit,
  words,
}: {
  readonly item: ReviewItem;
  readonly onEdit: (() => void) | undefined;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  return (
    <li className={`${card} gap-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{item.title}</p>
        {item.edited && <StatusChip tone="ok" label={t('knowledge.proposal.edited')} />}
      </div>
      {item.reason !== null && <p>{t('knowledge.proposal.reason', { reason: item.reason })}</p>}
      {item.quotes.map(({ url, quote }, index) => (
        <figure key={`${String(index)}-${url}`} className="flex flex-col gap-1">
          <figcaption className="text-small text-muted">{t('knowledge.proposal.quote')}</figcaption>
          <blockquote className="border-l-2 border-line pl-3 whitespace-pre-wrap">
            {quote}
          </blockquote>
        </figure>
      ))}
      {item.urls.length > 0 && (
        <ul className="flex flex-col gap-1">
          {item.urls.map((url) => (
            <li key={url} className="min-w-0 break-words">
              <a href={url} target="_blank" rel="noopener noreferrer" className={textLinkClass}>
                {URL.canParse(url) ? new URL(url).hostname : url}
              </a>{' '}
              <span className="text-small text-muted">{t('knowledge.proposal.opensSite')}</span>
            </li>
          ))}
        </ul>
      )}
      {onEdit !== undefined && (
        <div className="self-start">
          <Button variant="secondary" onClick={onEdit}>
            {t('knowledge.proposal.edit')}
          </Button>
        </div>
      )}
    </li>
  );
}

/** The three lists side by side on a wide screen, one under another on a phone. */
function Lists({
  items,
  editable,
  onEdit,
  words,
}: {
  readonly items: readonly ReviewItem[];
  readonly editable: ReadonlySet<string>;
  readonly onEdit: ((key: string) => void) | undefined;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {lists.map((list) => {
        const inList = items.filter((item) => item.list === list);
        return (
          <section key={list} className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h5 className="font-medium">
                {t('knowledge.proposal.list', { list })} ({inList.length})
              </h5>
              <p className="text-small text-muted">{t('knowledge.proposal.listLead', { list })}</p>
            </div>
            {inList.length === 0 ? (
              <p className="text-small text-muted">{t('knowledge.proposal.empty')}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {inList.map((item) => (
                  <ItemCard
                    key={item.key}
                    item={item}
                    onEdit={
                      onEdit !== undefined && editable.has(item.key)
                        ? () => {
                            onEdit(item.key);
                          }
                        : undefined
                    }
                    words={words}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Corrects one item by hand: the item as JSON, its official page and the passage that states it.
 * The API checks it as a proposal is checked and stores a new proposed version (ADR-0031).
 */
function EditItem({
  view,
  review,
  itemKey,
  onPick,
  words,
}: {
  readonly view: VersionView;
  readonly review: VersionReview;
  readonly itemKey: string;
  readonly onPick: (key: string) => void;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const titleId = useId();
  const queryClient = useQueryClient();
  const open = use(OpenRouteVersionContext);
  const picked = review.editable.find(({ key }) => key === itemKey);
  const [content, setContent] = useState(picked?.content ?? '');
  const [url, setUrl] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [quote, setQuote] = useState('');
  const save = useMutation({
    mutationFn: (): Promise<EditItemResponse> =>
      reach(
        api.call(routes.editVersionItem, {
          routeId: view.routeId,
          number: view.number,
          itemKey,
          content,
          source: { url: url.trim(), title: sourceTitle.trim() },
          quote: quote.trim(),
        }),
      ),
    networkMode: 'always',
    onSuccess: async ({ outcome }) => {
      if (outcome === 'stored') await queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });
  const stored = save.data?.outcome === 'stored' ? save.data.number : undefined;
  const ready =
    content.trim().length > 1 &&
    URL.canParse(url.trim()) &&
    sourceTitle.trim().length > 0 &&
    quote.trim().length > 0;

  return (
    <section aria-labelledby={titleId} className={`${card} gap-4`}>
      <h5 id={titleId} className="font-medium">
        {t('knowledge.proposal.editTitle')}
      </h5>
      <p className="text-small text-muted">{t('knowledge.proposal.editLead')}</p>
      <form
        className="grid gap-4 lg:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) save.mutate();
        }}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <SelectField
            label={t('knowledge.proposal.editItem')}
            value={itemKey}
            options={review.editable.map(({ key, title }) => ({ value: key, label: title }))}
            onChange={(key) => {
              setContent(review.editable.find((each) => each.key === key)?.content ?? '');
              save.reset();
              onPick(key);
            }}
          />
          <TextArea
            label={t('knowledge.proposal.editContent')}
            value={content}
            maxLength={maxItemJsonLength}
            rows={14}
            onChange={setContent}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <TextField
            label={t('knowledge.proposal.editUrl')}
            type="url"
            inputMode="url"
            autoComplete="off"
            value={url}
            onChange={(event) => {
              setUrl(event.currentTarget.value);
            }}
          />
          <TextField
            label={t('knowledge.proposal.editSourceTitle')}
            maxLength={200}
            value={sourceTitle}
            onChange={(event) => {
              setSourceTitle(event.currentTarget.value);
            }}
          />
          <TextArea
            label={t('knowledge.proposal.editQuote')}
            value={quote}
            maxLength={2000}
            rows={6}
            onChange={setQuote}
          />
          <div className="self-start">
            <Button type="submit" disabled={!ready || save.isPending}>
              {t('knowledge.proposal.editSave')}
            </Button>
          </div>
          <div role="status" className="flex flex-col gap-2">
            {save.isPending && <p>{t('knowledge.proposal.editSaving')}</p>}
            {save.isError && (
              <p>{t('knowledge.proposal.editFailure', { reason: editFailure(save.error) })}</p>
            )}
            {stored !== undefined && (
              <>
                <p>{t('knowledge.proposal.editStored', { number: stored })}</p>
                {open !== undefined && (
                  <div className="self-start">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        open(stored);
                      }}
                    >
                      {t('knowledge.proposal.editOpen', { number: stored })}
                    </Button>
                  </div>
                )}
              </>
            )}
            {save.data?.outcome === 'refused' && (
              <>
                <p>{t('knowledge.proposal.editRefused')}</p>
                <ul className="flex list-disc flex-col gap-1 pl-5 font-mono text-small break-words">
                  {save.data.problems.map((problem, index) => (
                    <li key={`${String(index)}-${problem}`}>{problem}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}

/**
 * A new country's first official-domain list (ADR-0031): each host with the registry page code
 * found it on, decided apart and before the route that pins it.
 */
function DomainListReview({
  list,
  country,
  words,
}: {
  readonly list: ProposedDomainList;
  readonly country: string;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const titleId = useId();
  const countryName = words.country(country);
  return (
    <section aria-labelledby={titleId} className={`${card} gap-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h5 id={titleId} className="font-medium">
            {t('knowledge.proposal.domainList.title', { country: countryName })}
          </h5>
          <p className="text-small text-muted">
            {t('knowledge.proposal.domainList.issuer', { issuer: list.issuer })}
          </p>
        </div>
        <StatusChip
          tone={stateTone(list.state)}
          label={t('knowledge.proposal.domainList.state', { state: list.state })}
        />
      </div>
      {list.state === 'proposed' && <p>{t('knowledge.proposal.domainList.lead')}</p>}
      <ul className="grid gap-3 md:grid-cols-2">
        {list.hosts.map(({ host, proof }) => (
          <li key={host} className="flex min-w-0 flex-col gap-1">
            <span className="font-medium break-words">{host}</span>
            <span className="text-small break-words">
              <span className="text-muted">{t('knowledge.proposal.domainList.proof')} </span>
              <a
                href={proof.url}
                target="_blank"
                rel="noopener noreferrer"
                className={textLinkClass}
              >
                {proof.url}
              </a>{' '}
              <span className="text-muted">{t('knowledge.proposal.opensSite')}</span>
            </span>
            <span className="text-small text-muted break-words">
              {t('knowledge.proposal.domainList.proofTitle', { title: proof.title })}
            </span>
          </li>
        ))}
      </ul>
      {list.state !== 'active' && (
        <Decision
          subject="list"
          state={list.state}
          decide={(kind) => decideOfficialDomains(kind, list)}
          activateLead={t('knowledge.proposal.domainList.activateLead', { country: countryName })}
          rejectWarning={null}
          words={words}
        />
      )}
    </section>
  );
}

/** Every version of the route with its state, superseded and rejected ones included. */
function RouteHistory({
  view,
  words,
}: {
  readonly view: VersionView;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const open = use(OpenRouteVersionContext);
  const listed = useQuery(knowledgeVersionsQuery);
  const versions = (listed.data?.versions ?? [])
    .filter(({ routeId }) => routeId === view.routeId)
    .toSorted((left, right) => right.number - left.number);
  if (versions.length < 2) return null;
  return (
    <section className="flex flex-col gap-2">
      <h5 className="font-medium">{t('knowledge.proposal.history')}</h5>
      <ol className="flex flex-col gap-2">
        {versions.map((version) => (
          <li key={version.number} className="flex flex-wrap items-center gap-2">
            {version.number === view.number || open === undefined ? (
              <span className="font-medium">
                {t('knowledge.proposal.historyVersion', {
                  number: version.number,
                  date: words.date(version.effectiveFrom),
                })}
                {version.number === view.number && ` (${t('knowledge.proposal.thisVersion')})`}
              </span>
            ) : (
              <button
                type="button"
                className={textLinkClass}
                onClick={() => {
                  open(version.number);
                }}
              >
                {t('knowledge.proposal.historyVersion', {
                  number: version.number,
                  date: words.date(version.effectiveFrom),
                })}
              </button>
            )}
            <StatusChip
              tone={stateTone(version.state)}
              label={t('knowledge.state', { state: version.state })}
            />
            {version.superseded && (
              <span className="text-small text-muted">{t('knowledge.proposal.superseded')}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * A version's review (ADR-0031): the three lists its update request ended with, each item with its
 * official page and passage, a hand correction of one item, and the route's history.
 */
export function ProposalReview({
  view,
  words,
}: {
  readonly view: VersionView;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const titleId = useId();
  const review = useQuery(versionReviewQuery(view.routeId, view.number));
  const [editing, setEditing] = useState<string | null>(null);
  if (review.isError)
    return <p className="text-small text-muted">{t('knowledge.proposal.loadFailure')}</p>;
  if (review.data === undefined) return null;
  const data = review.data;
  const canEdit = view.state !== 'rejected' && data.editable.length > 0;
  const startEdit = canEdit ? setEditing : undefined;
  return (
    <section aria-labelledby={titleId} className={`${card} gap-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h4 id={titleId} className="font-medium">
            {t('knowledge.proposal.title')}
          </h4>
          <p className="text-small text-muted">
            {t('knowledge.proposal.origin', { origin: data.origin })}
          </p>
        </div>
        {canEdit && editing === null && (
          <Button
            variant="secondary"
            onClick={() => {
              setEditing(data.editable[0]?.key ?? null);
            }}
          >
            {t('knowledge.proposal.edit')}
          </Button>
        )}
      </div>
      {data.domainList !== null && (
        <DomainListReview list={data.domainList} country={view.country} words={words} />
      )}
      {data.items.length > 0 && (
        <Lists
          items={data.items}
          editable={new Set(data.editable.map(({ key }) => key))}
          onEdit={startEdit}
          words={words}
        />
      )}
      {editing !== null && canEdit && (
        <EditItem
          key={editing}
          view={view}
          review={data}
          itemKey={editing}
          onPick={setEditing}
          words={words}
        />
      )}
      <RouteHistory view={view} words={words} />
    </section>
  );
}
