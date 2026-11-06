import { routes, type KnowledgeVersion, type RuleReports } from '@arca/api-contract/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ruleReportsQuery } from '../api.js';
import { textLinkClass } from '../forms/text-link.js';
import type { KnowledgeWords } from './words.js';

type Report = RuleReports['reports'][number];

/** The open reports of one requirement, with a count per reason. */
interface Reported {
  readonly key: string;
  readonly routeId: string;
  readonly versionNumber: number;
  readonly requirementId: string;
  readonly reasons: readonly Report[];
}

function byRequirement(reports: readonly Report[]): Reported[] {
  const grouped = new Map<string, Reported>();
  for (const report of reports) {
    const key = `${report.routeId}:${String(report.versionNumber)}:${report.requirementId}`;
    const known = grouped.get(key);
    grouped.set(key, {
      key,
      routeId: report.routeId,
      versionNumber: report.versionNumber,
      requirementId: report.requirementId,
      reasons: [...(known?.reasons ?? []), report],
    });
  }
  return [...grouped.values()];
}

/**
 * Members' reports of possibly wrong requirements (spec 0007, R8): counts per reason only, never
 * a note or who reported. The approver closes a requirement's reports once it is researched.
 */
export function ReportsSection({
  versions,
  words,
}: {
  readonly versions: readonly KnowledgeVersion[];
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const queryClient = useQueryClient();
  const reports = useQuery(ruleReportsQuery);
  const [failed, setFailed] = useState<string>();
  const title = t('knowledge.reports.title');
  const titleOf = (routeId: string, versionNumber: number) =>
    versions.find((version) => version.routeId === routeId && version.number === versionNumber)
      ?.title ?? routeId;
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="font-medium">{title}</h3>
      {reports.isError && <p>{t('knowledge.reports.loadFailure')}</p>}
      {reports.data?.reports.length === 0 && (
        <p className="text-muted">{t('knowledge.reports.none')}</p>
      )}
      {reports.data !== undefined && reports.data.reports.length > 0 && (
        <>
          <p className="text-muted">{t('knowledge.reports.lead')}</p>
          <ul className="flex flex-col gap-3">
            {byRequirement(reports.data.reports).map((reported) => (
              <li key={reported.key} className="flex flex-col gap-1">
                <p className="font-medium">
                  {t('knowledge.reports.item', {
                    title: titleOf(reported.routeId, reported.versionNumber),
                    number: reported.versionNumber,
                    requirement: reported.requirementId,
                  })}
                </p>
                <p className="text-small text-muted">
                  {words.list(
                    reported.reasons.map(({ reason, count }) =>
                      t('knowledge.reports.reason', { reason, n: count }),
                    ),
                  )}
                </p>
                {failed === reported.key && (
                  <p role="alert" className="text-small text-danger-ink">
                    {t('knowledge.reports.closeFailure')}
                  </p>
                )}
                <button
                  type="button"
                  className={`${textLinkClass} self-start`}
                  onClick={() => {
                    setFailed(undefined);
                    api
                      .call(routes.closeRuleReports, {
                        routeId: reported.routeId,
                        versionNumber: reported.versionNumber,
                        requirementId: reported.requirementId,
                      })
                      .then(() => queryClient.invalidateQueries(ruleReportsQuery))
                      .catch(() => {
                        setFailed(reported.key);
                      });
                  }}
                >
                  {t('knowledge.reports.close')}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
