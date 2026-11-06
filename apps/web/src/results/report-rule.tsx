import {
  ApiError,
  type ReportRuleRequest,
  routes,
  ruleReportReasons,
} from '@arca/api-contract/client';
import { Button, ChoiceGroup } from '@arca/ui';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api.js';
import { textLinkClass } from '../forms/text-link.js';
import { TextField } from '../forms/text-field.js';

type Reason = ReportRuleRequest['reason'];
type State = 'closed' | 'open' | 'sending' | 'sent' | 'limited' | 'failed';

/**
 * Reports a requirement of the viewer's results as possibly wrong (spec 0007, R8): a reason from
 * the fixed list and an optional note, which only the viewer sees again.
 */
export function ReportRule({
  rule,
}: {
  readonly rule: Pick<ReportRuleRequest, 'routeId' | 'versionNumber' | 'requirementId'>;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>('closed');
  const [reason, setReason] = useState<Reason>('outdated');
  const [note, setNote] = useState('');
  if (state === 'sent') return <p className="text-small">{t('results.report.sent')}</p>;
  if (state === 'closed') {
    return (
      <button
        type="button"
        className={`${textLinkClass} self-start text-small`}
        onClick={() => {
          setState('open');
        }}
      >
        {t('results.report.open')}
      </button>
    );
  }
  const send = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState('sending');
    const trimmed = note.trim();
    try {
      await api.call(routes.reportRule, {
        ...rule,
        reason,
        ...(trimmed === '' ? {} : { note: trimmed }),
      });
      setState('sent');
    } catch (error) {
      setState(error instanceof ApiError && error.status === 429 ? 'limited' : 'failed');
    }
  };
  return (
    <form
      aria-label={t('results.report.title')}
      className="flex flex-col gap-3 rounded-control border border-line p-3"
      onSubmit={(event) => void send(event)}
    >
      <ChoiceGroup
        legend={t('results.report.legend')}
        choices={ruleReportReasons.map((value) => ({
          value,
          label: t('results.report.reason', { reason: value }),
        }))}
        value={reason}
        onChange={setReason}
      />
      <TextField
        label={t('results.report.note')}
        hint={t('results.report.noteHint')}
        value={note}
        maxLength={500}
        onChange={(event) => {
          setNote(event.target.value);
        }}
      />
      {(state === 'limited' || state === 'failed') && (
        <p role="alert" className="text-small text-danger-ink">
          {t(state === 'limited' ? 'results.report.tooMany' : 'results.report.failure')}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? t('results.report.sending') : t('results.report.send')}
        </Button>
        <button
          type="button"
          className={textLinkClass}
          onClick={() => {
            setState('closed');
          }}
        >
          {t('results.report.cancel')}
        </button>
      </div>
    </form>
  );
}
