import {
  type ApiError,
  type KnowledgeVersion,
  type MemberUpdateRequest,
  routes,
} from '@arca/api-contract/client';
import { Button, StatusChip } from '@arca/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, memberUpdateRequestsQuery, updateRequestQuery } from '../api.js';
import { TextField } from '../forms/text-field.js';
import { commonFailure, reach } from '../requests.js';
import { memberStateTones } from '../results/update-request.js';
import { MarkedText, SourceList } from './corrections.js';
import { countryOfRoute } from './review-order.js';
import { card } from './review-parts.js';
import type { KnowledgeWords } from './words.js';

const actionCodes = [
  'decided',
  'update_live',
  'update_off',
  'update_not_started',
  'list_pending',
  'not_found',
] as const;
const isActionCode = (code: string): code is (typeof actionCodes)[number] =>
  (actionCodes as readonly string[]).includes(code);
const actionFailure = (error: unknown) =>
  commonFailure(error, ({ code }: ApiError) => (isActionCode(code) ? code : undefined));

function MemberRequestEntry({
  request,
  canDownload,
  title,
  words,
  onOpenVersion,
}: {
  readonly request: MemberUpdateRequest;
  readonly canDownload: boolean;
  readonly title: string;
  readonly words: KnowledgeWords;
  readonly onOpenVersion: (routeId: string, number: number) => void;
}) {
  const { t } = words;
  const titleId = useId();
  const queryClient = useQueryClient();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const reload = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: memberUpdateRequestsQuery.queryKey }),
      queryClient.invalidateQueries({ queryKey: updateRequestQuery(request.routeId).queryKey }),
    ]);
  };
  const release = useMutation({
    mutationFn: () => reach(api.call(routes.releaseMemberUpdateRequest, { id: request.id })),
    networkMode: 'always',
    onSuccess: reload,
  });
  const decline = useMutation({
    mutationFn: () => {
      const trimmed = reason.trim();
      return reach(
        api.call(routes.declineMemberUpdateRequest, {
          id: request.id,
          ...(trimmed === '' ? {} : { reason: trimmed }),
        }),
      );
    },
    networkMode: 'always',
    onSuccess: async () => {
      setDeclining(false);
      await reload();
    },
  });
  const failed = release.isError ? release.error : decline.isError ? decline.error : undefined;
  const busy = release.isPending || decline.isPending;
  return (
    <li>
      <section aria-labelledby={titleId} className={`${card} gap-3`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h5 id={titleId} className="font-medium break-words">
              {t('knowledge.memberRequests.requestTitle', {
                title,
                number: request.versionNumber,
              })}
            </h5>
            <p className="text-small text-muted">
              {t('knowledge.memberRequests.filedAt', {
                date: new Intl.DateTimeFormat(words.language, {
                  dateStyle: 'short',
                  timeStyle: 'short',
                }).format(new Date(request.createdAt)),
              })}
            </p>
          </div>
          <StatusChip
            tone={memberStateTones[request.state]}
            label={t('results.update.state', { state: request.state })}
          />
        </div>
        {request.erased ? (
          <p className="text-small text-muted">{t('knowledge.corrections.erased')}</p>
        ) : request.note === null ? (
          <p className="text-small text-muted">{t('knowledge.memberRequests.noNote')}</p>
        ) : (
          <MarkedText text={request.note} />
        )}
        <SourceList
          request={
            canDownload
              ? request
              : { ...request, sources: request.sources.filter(({ kind }) => kind !== 'file') }
          }
          words={words}
        />
        {!canDownload && request.sources.some(({ kind }) => kind === 'file') && (
          <p className="text-small text-muted">{t('knowledge.memberRequests.ownerFiles')}</p>
        )}
        {request.run !== null && (
          <p className="text-small text-muted">
            {t('knowledge.memberRequests.run', { run: request.run })}
          </p>
        )}
        {request.reason !== null && (
          <p className="text-small whitespace-pre-wrap">
            {t('results.update.reason', { reason: request.reason })}
          </p>
        )}
        {declining ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              decline.mutate();
            }}
          >
            <TextField
              label={t('knowledge.memberRequests.reason')}
              hint={t('knowledge.memberRequests.reasonHint')}
              maxLength={500}
              value={reason}
              onChange={(event) => {
                setReason(event.currentTarget.value);
              }}
            />
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={busy}>
                {t('knowledge.memberRequests.confirmDecline')}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setDeclining(false);
                }}
              >
                {t('knowledge.cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-3">
            {request.canRelease && (
              <Button
                disabled={busy}
                onClick={() => {
                  release.mutate();
                }}
              >
                {t('knowledge.memberRequests.release')}
              </Button>
            )}
            {request.canDecline && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setDeclining(true);
                }}
              >
                {t('knowledge.memberRequests.decline')}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => {
                onOpenVersion(request.routeId, request.versionNumber);
              }}
            >
              {t('knowledge.memberRequests.openVersion')}
            </Button>
          </div>
        )}
        <p role="status" className="text-small">
          {release.isPending
            ? t('knowledge.memberRequests.releasing')
            : release.isSuccess
              ? t('knowledge.memberRequests.released')
              : ''}
        </p>
        {failed !== undefined && (
          <p role="alert" className="text-small text-danger-ink">
            {t('knowledge.memberRequests.failure', { reason: actionFailure(failed) })}
          </p>
        )}
      </section>
    </li>
  );
}

/**
 * Members' update requests on the activation screen (ADR-0031, #462): what each member asked for,
 * for an admin to release, which starts the update, or decline with a reason the member reads.
 */
export function MemberRequestsSection({
  versions,
  country,
  words,
  onOpenVersion,
}: {
  readonly versions: readonly KnowledgeVersion[];
  /** Only this country's requests, when given. */
  readonly country?: string;
  readonly words: KnowledgeWords;
  readonly onOpenVersion: (routeId: string, number: number) => void;
}) {
  const { t } = words;
  const listed = useQuery(memberUpdateRequestsQuery);
  const title = t('knowledge.memberRequests.title');
  if (listed.isError) {
    return <p className="text-small text-muted">{t('knowledge.memberRequests.loadFailure')}</p>;
  }
  if (listed.data === undefined) return null;
  const titles = new Map(versions.map((version) => [version.routeId, version.title]));
  const { canDownload } = listed.data;
  const requests = listed.data.requests.filter(
    ({ routeId }) => country === undefined || countryOfRoute(versions, routeId) === country,
  );
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h3 className="font-medium">{title}</h3>
      <p className="text-small text-muted">{t('knowledge.memberRequests.lead')}</p>
      {requests.length === 0 ? (
        <p className="text-small text-muted">{t('knowledge.memberRequests.none')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((request) => (
            <MemberRequestEntry
              key={request.id}
              request={request}
              canDownload={canDownload}
              title={titles.get(request.routeId) ?? request.routeId}
              words={words}
              onOpenVersion={onOpenVersion}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
