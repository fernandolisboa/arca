import {
  type ApiError,
  type OwnUpdateRequest,
  correctionLimits,
  routes,
} from '@arca/api-contract/client';
import { Button, StatusChip, type StatusTone } from '@arca/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, ownUpdateRequestsQuery } from '../api.js';
import { textLinkClass } from '../forms/text-link.js';
import { correctionFileAccept, correctionFileType } from '../knowledge/correction-file-type.js';
import { uploadCorrectionFile } from '../knowledge/correction-upload.js';
import { TextArea } from '../knowledge/corrections.js';
import { parsedLinks } from '../knowledge/new-route-links.js';
import type { KnowledgeWords } from '../knowledge/words.js';
import { commonFailure, reach } from '../requests.js';

const fileCodes = ['update_live', 'not_found', 'not_uploaded', 'upload_mismatch'] as const;
const isFileCode = (code: string): code is (typeof fileCodes)[number] =>
  (fileCodes as readonly string[]).includes(code);
const fileFailure = (error: unknown) =>
  commonFailure(error, ({ code }: ApiError) => (isFileCode(code) ? code : undefined));

export const memberStateTones: Record<OwnUpdateRequest['state'], StatusTone> = {
  received: 'unknown',
  released: 'warn',
  finished: 'ok',
  declined: 'danger',
};

/** Room for every link at the longest address, one per line. */
const linksTextLength = correctionLimits.sources * (correctionLimits.url + 1);

function UpdateForm({
  routeId,
  versionNumber,
  words,
  onFiled,
  onCancel,
}: {
  readonly routeId: string;
  readonly versionNumber: number;
  readonly words: KnowledgeWords;
  readonly onFiled: () => void;
  readonly onCancel: () => void;
}) {
  const { t } = words;
  const queryClient = useQueryClient();
  const fileId = useId();
  const [note, setNote] = useState('');
  const [linksText, setLinksText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const maxLinks = correctionLimits.sources - (file === null ? 0 : 1);
  const links = parsedLinks(linksText, maxLinks);
  const fileType = file === null ? null : correctionFileType(file);
  const filing = useMutation({
    mutationFn: async () => {
      const files =
        file === null || fileType === null || fileType === undefined
          ? []
          : [await uploadCorrectionFile(file, fileType)];
      const trimmed = note.trim();
      return reach(
        api.call(routes.fileMemberUpdateRequest, {
          routeId,
          versionNumber,
          ...(trimmed === '' ? {} : { note: trimmed }),
          links: links ?? [],
          files,
        }),
      );
    },
    networkMode: 'always',
    onSuccess: async () => {
      onFiled();
      await queryClient.invalidateQueries({ queryKey: ownUpdateRequestsQuery.queryKey });
    },
  });
  const ready = links !== undefined && fileType !== undefined;
  return (
    <form
      className="flex flex-col gap-3 rounded-control border border-line p-3"
      aria-label={t('results.update.title')}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) filing.mutate();
      }}
    >
      <p className="text-small">{t('results.update.lead')}</p>
      <TextArea
        label={t('results.update.note')}
        value={note}
        maxLength={correctionLimits.note}
        rows={3}
        onChange={setNote}
      />
      <TextArea
        label={t('results.update.links')}
        value={linksText}
        maxLength={linksTextLength}
        rows={2}
        onChange={setLinksText}
      />
      {links === undefined && (
        <p className="text-small text-danger-ink">
          {t('results.update.badLinks', { max: maxLinks })}
        </p>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={fileId} className="font-medium">
          {t('results.update.file')}
        </label>
        <input
          id={fileId}
          type="file"
          accept={correctionFileAccept.join(',')}
          className="text-small"
          onChange={(event) => {
            setFile(event.currentTarget.files?.[0] ?? null);
          }}
        />
        <p className="text-small text-danger-ink">{t('results.update.fileHint')}</p>
        {fileType === undefined && (
          <p className="text-small text-danger-ink">{t('results.update.badFile')}</p>
        )}
      </div>
      <p className="text-small text-muted">{t('results.update.privacy')}</p>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={!ready || filing.isPending}>
          {filing.isPending ? t('results.update.sending') : t('results.update.send')}
        </Button>
        <Button variant="secondary" disabled={filing.isPending} onClick={onCancel}>
          {t('results.update.cancel')}
        </Button>
      </div>
      {filing.isError && (
        <p role="alert" className="text-small text-danger-ink">
          {t('results.update.failure', { reason: fileFailure(filing.error) })}
        </p>
      )}
    </form>
  );
}

/**
 * A member's update request for one route of the results (ADR-0031, #462): the newest one's
 * state, and a form to ask for one while none waits.
 */
export function RouteUpdateRequest({
  routeId,
  versionNumber,
  words,
}: {
  readonly routeId: string;
  readonly versionNumber: number;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const own = useQuery(ownUpdateRequestsQuery);
  const [open, setOpen] = useState(false);
  const newest = own.data?.requests.find((request) => request.routeId === routeId);
  const waiting = newest?.state === 'received' || newest?.state === 'released';
  return (
    <div className="flex flex-col gap-2">
      {newest !== undefined && (
        <div className="flex flex-col gap-1" role="status">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-small">{t('results.update.yours')}</span>
            <StatusChip
              tone={memberStateTones[newest.state]}
              label={t('results.update.state', { state: newest.state })}
            />
          </div>
          <p className="text-small text-muted">
            {t('results.update.stateHint', { state: newest.state })}
          </p>
          {newest.reason !== null && (
            <p className="text-small whitespace-pre-wrap">
              {t('results.update.reason', { reason: newest.reason })}
            </p>
          )}
        </div>
      )}
      {own.isSuccess && !waiting && !open && (
        <button
          type="button"
          className={`${textLinkClass} self-start text-small`}
          onClick={() => {
            setOpen(true);
          }}
        >
          {t('results.update.open')}
        </button>
      )}
      {open && (
        <UpdateForm
          routeId={routeId}
          versionNumber={versionNumber}
          words={words}
          onFiled={() => {
            setOpen(false);
          }}
          onCancel={() => {
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
