import {
  type ApiError,
  type NewRouteProgress,
  maxNewRouteLinks,
  routes,
} from '@arca/api-contract/client';
import { Button } from '@arca/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, newRouteRequestsQuery } from '../api.js';
import { FlagLead } from '../country-flag.js';
import { CountryField } from '../forms/country-field.js';
import { TextField } from '../forms/text-field.js';
import { commonFailure, reach } from '../requests.js';
import { TextArea } from './corrections.js';
import { parsedLinks } from './new-route-links.js';
import { card } from './review-parts.js';
import { RequestProgressBody, RequestStateChip } from './update-request.js';
import type { KnowledgeWords } from './words.js';

const startCodes = [
  'update_live',
  'update_off',
  'update_not_started',
  'not_found',
  'links_needed',
] as const;
const isStartCode = (code: string): code is (typeof startCodes)[number] =>
  (startCodes as readonly string[]).includes(code);
const startFailure = (error: unknown) =>
  commonFailure(error, ({ code }: ApiError) => (isStartCode(code) ? code : undefined));

/** Room for every link at the contract's longest address, one per line. */
const linksTextLength = maxNewRouteLinks * 2001;

function NewRouteForm({
  countries,
  withLists,
  words,
  onStarted,
  onCancel,
}: {
  readonly countries: readonly string[];
  readonly withLists: ReadonlySet<string>;
  readonly words: KnowledgeWords;
  readonly onStarted: () => void;
  readonly onCancel: () => void;
}) {
  const { t } = words;
  const queryClient = useQueryClient();
  const [country, setCountry] = useState('');
  const [visa, setVisa] = useState('');
  const [linksText, setLinksText] = useState('');
  const links = parsedLinks(linksText);
  const needsLinks = country !== '' && !withLists.has(country);
  const countryName = country === '' ? '' : words.country(country);
  const start = useMutation({
    mutationFn: (body: { country: string; visa: string; links: string[] }) =>
      reach(api.call(routes.startNewRouteRequest, body)),
    networkMode: 'always',
    onSuccess: async () => {
      setVisa('');
      setLinksText('');
      onStarted();
      await queryClient.invalidateQueries({ queryKey: newRouteRequestsQuery.queryKey });
    },
  });
  const ready =
    country !== '' &&
    visa.trim().length >= 2 &&
    links !== undefined &&
    (!needsLinks || links.length > 0);
  const options = countries
    .map((code) => ({ value: code, label: words.country(code) }))
    .toSorted((left, right) => left.label.localeCompare(right.label, words.language));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) start.mutate({ country, visa: visa.trim(), links });
      }}
    >
      <CountryField
        label={t('knowledge.newRoute.country')}
        placeholder={t('knowledge.newRoute.pickCountry')}
        value={country}
        groups={[{ options }]}
        onChange={(code) => {
          start.reset();
          setCountry(code);
        }}
      />
      <TextField
        label={t('knowledge.newRoute.visa')}
        hint={t('knowledge.newRoute.visaHint')}
        maxLength={120}
        autoComplete="off"
        value={visa}
        onChange={(event) => {
          setVisa(event.currentTarget.value);
        }}
      />
      <TextArea
        label={t('knowledge.newRoute.links')}
        value={linksText}
        maxLength={linksTextLength}
        rows={4}
        onChange={setLinksText}
      />
      <p className="-mt-2 text-small text-muted">
        {t('knowledge.newRoute.linksHint', {
          needed: country === '' ? 'none' : String(needsLinks),
          country: countryName,
          max: maxNewRouteLinks,
        })}
      </p>
      {links === undefined && (
        <p className="text-small text-danger-ink">
          {t('knowledge.newRoute.badLinks', { max: maxNewRouteLinks })}
        </p>
      )}
      {needsLinks && <p>{t('knowledge.newRoute.newCountry', { country: countryName })}</p>}
      <p className="text-small text-muted">{t('knowledge.newRoute.cost')}</p>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={!ready || start.isPending}>
          {t('knowledge.newRoute.submit')}
        </Button>
        <Button variant="secondary" disabled={start.isPending} onClick={onCancel}>
          {t('knowledge.cancel')}
        </Button>
      </div>
      <p role="status">
        {start.isPending
          ? t('knowledge.newRoute.starting')
          : start.isError
            ? t('knowledge.newRoute.startFailure', { reason: startFailure(start.error) })
            : ''}
      </p>
    </form>
  );
}

function NewRouteEntry({
  request,
  words,
  onOpenVersion,
}: {
  readonly request: NewRouteProgress;
  readonly words: KnowledgeWords;
  readonly onOpenVersion: (routeId: string, number: number) => void;
}) {
  const { t } = words;
  const titleId = useId();
  const { proposedRouteId, proposedNumber } = request;
  return (
    <li>
      <section aria-labelledby={titleId} className={`${card} gap-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h5 id={titleId} className="font-medium break-words">
              <FlagLead code={request.country} />
              {t('knowledge.newRoute.requestTitle', {
                visa: request.visa,
                country: words.country(request.country),
              })}
            </h5>
            <p className="text-small text-muted">
              {t('knowledge.newRoute.requestedAt', {
                date: new Intl.DateTimeFormat(words.language, {
                  dateStyle: 'short',
                  timeStyle: 'short',
                }).format(new Date(request.requestedAt)),
              })}
            </p>
            {request.newCountry && (
              <p className="text-small text-muted">{t('knowledge.newRoute.firstList')}</p>
            )}
          </div>
          <RequestStateChip progress={request} words={words} />
        </div>
        <RequestProgressBody
          progress={request}
          proposed={
            proposedRouteId !== null &&
            proposedNumber !== null && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-small text-muted">
                  {t('knowledge.newRoute.review', { routeId: proposedRouteId })}
                </p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    onOpenVersion(proposedRouteId, proposedNumber);
                  }}
                >
                  {t('knowledge.newRoute.openProposal')}
                </Button>
              </div>
            )
          }
          words={words}
        />
      </section>
    </li>
  );
}

/**
 * New-route requests on the activation screen (ADR-0031): an admin names a country and a visa
 * the catalog lacks, and follows each request until its proposal waits for review.
 */
export function NewRouteRequestsSection({
  words,
  onOpenVersion,
}: {
  readonly words: KnowledgeWords;
  readonly onOpenVersion: (routeId: string, number: number) => void;
}) {
  const { t } = words;
  const listed = useQuery(newRouteRequestsQuery);
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const title = t('knowledge.newRoute.title');
  if (listed.isError) {
    return <p className="text-small text-muted">{t('knowledge.newRoute.loadFailure')}</p>;
  }
  if (listed.data === undefined) return null;
  const { requests, countries, countriesWithLists } = listed.data;
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h3 className="font-medium">{title}</h3>
      <p className="text-small text-muted">{t('knowledge.newRoute.lead')}</p>
      {open ? (
        <div className={card}>
          <NewRouteForm
            countries={countries}
            withLists={new Set(countriesWithLists)}
            words={words}
            onStarted={() => {
              setOpen(false);
              setStarted(true);
            }}
            onCancel={() => {
              setOpen(false);
            }}
          />
        </div>
      ) : (
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setStarted(false);
              setOpen(true);
            }}
          >
            {t('knowledge.newRoute.open')}
          </Button>
        </div>
      )}
      {started && (
        <p role="status" className="text-small text-muted">
          {t('knowledge.newRoute.started')}
        </p>
      )}
      {requests.length > 0 && (
        <>
          <h4 className="font-medium">{t('knowledge.newRoute.recent')}</h4>
          <ul className="flex flex-col gap-3">
            {requests.map((request) => (
              <NewRouteEntry
                key={request.requestId}
                request={request}
                words={words}
                onOpenVersion={onOpenVersion}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
