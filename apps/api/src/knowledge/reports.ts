import type { CloseRuleReportsRequest, RuleReports } from '@arca/api-contract/routes';
import type { Database } from '@arca/db';
import { sql } from 'drizzle-orm';

/**
 * Members' reports of possibly wrong requirements as admins see them (spec 0007, R8): through
 * the two reviewed definer functions, which name no note, case or reporter. The API calls them
 * for an admin only.
 */
export interface RuleReportReview {
  readonly open: () => Promise<RuleReports['reports']>;
  readonly close: (reference: CloseRuleReportsRequest) => Promise<number>;
}

/** Closes a version's open reports, of one requirement or, with null, of every requirement. */
export async function closeRuleReports(
  db: Database,
  routeId: string,
  versionNumber: number,
  requirementId: string | null,
): Promise<number> {
  const closed = await db.execute<{ closed: number }>(
    sql`SELECT cases.close_rule_reports(${routeId}, ${versionNumber}, ${requirementId}) AS closed`,
  );
  return closed.rows[0]?.closed ?? 0;
}

/** On the app_api pool, which may only execute the functions. */
export function createRuleReportReview(db: () => Database): RuleReportReview {
  return {
    open: async () => {
      const rows = await db().execute<{
        route_id: string;
        version_number: number;
        requirement_id: string;
        reason: RuleReports['reports'][number]['reason'];
        reports: string;
      }>(sql`SELECT * FROM cases.open_rule_reports()`);
      return rows.rows.map((row) => ({
        routeId: row.route_id,
        versionNumber: row.version_number,
        requirementId: row.requirement_id,
        reason: row.reason,
        count: Number(row.reports),
      }));
    },
    close: ({ routeId, versionNumber, requirementId }) =>
      closeRuleReports(db(), routeId, versionNumber, requirementId),
  };
}
