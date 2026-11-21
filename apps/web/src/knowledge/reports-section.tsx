import { RequestFold } from './folds.js';
import { routes, type KnowledgeVersion, type RuleReports } from '@arca/api-contract/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, ruleReportsQuery } from '../api.js';
import { textLinkClass } from '../forms/text-link.js';
import { countryOfRoute } from './review-order.js';
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

/** The open reports grouped by requirement, as the section lists them. */
export function byRequirement(reports: readonly Report[]): Reported[] {
  const grouped = new Map<string, Reported & { reasons: Report[] }>();
  for (const report of reports) {
    const key = `${report.routeId}:${String(report.versionNumber)}:${report.requirementId}`;
    const known = grouped.get(key);
    if (known === undefined) {
      grouped.set(key, {
        key,
        routeId: report.routeId,
        versionNumber: report.versionNumber,
        requirementId: report.requirementId,
        reasons: [report],
      });
    } else {
      known.reasons.push(report);
    }
  }
  return [...grouped.values()];
}

/**
 * Members' reports of possibly wrong requirements (spec 0007, R8): counts per reason only, never
 * a note or who reported. An admin closes a requirement's reports once it is researched.
 */
export function ReportsSection({
  versions,
  country,
  words,
}: {
  readonly versions: readonly KnowledgeVersion[];
  /** Only this country's reports, when given. */
  readonly country?: string;
  readonly words: KnowledgeWords;
}) {
  const { t } = words;
  const queryClient = useQueryClient();
  const reports = useQuery(ruleReportsQuery);
  const [failed, setFailed] = useState<string>();
  const baseId = useId();
  const title = t('knowledge.reports.title');
  const titleOf = (routeId: string, versionNumber: number) =>
    versions.find((version) => version.routeId === routeId && version.number === versionNumber)
      ?.title ?? routeId;
  const listed = reports.data?.reports.filter(
    ({ routeId }) => country === undefined || countryOfRoute(versions, routeId) === country,
  );
  return (
    <RequestFold
      id="reports"
      title={title}
      count={listed?.length}
      summary={listed === undefined ? '' : t('knowledge.lists.requestCount', { n: listed.length })}
    >
      {reports.isError && <p>{t('knowledge.reports.loadFailure')}</p>}
      {listed?.length === 0 && <p className="text-small text-muted">{t('knowledge.reports.none')}</p>}
      {listed !== undefined && listed.length > 0 && (
        <>
          <p className="text-small text-muted">{t('knowledge.reports.lead')}</p>
          <ul className="flex flex-col gap-3">
            {byRequirement(listed).map((reported, index) => (
              <li key={reported.key} className="flex flex-col gap-1">
                <p id={`${baseId}-${String(index)}`} className="font-medium">
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
                  aria-describedby={`${baseId}-${String(index)}`}
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
    </RequestFold>
  );
}
