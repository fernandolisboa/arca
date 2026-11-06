-- Reports of a possibly wrong rule (spec 0007, R8). app_api inserts a member's own report and reads
-- their own reports back; app_jobs erases them under the reporter's identity and deletes them 365
-- days after creation; approvers see and close the open ones only through the two definer
-- functions below, which name no note, case or reporter. The API calls them only for an approver.
ALTER TABLE "cases"."rule_report" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON "cases"."rule_report" TO app_api;
--> statement-breakpoint
GRANT INSERT ("case_id", "reporter_account_id", "route_id", "version_number", "requirement_id", "reason", "note") ON "cases"."rule_report" TO app_api;
--> statement-breakpoint
GRANT SELECT, DELETE ON "cases"."rule_report" TO app_jobs;
--> statement-breakpoint
GRANT SELECT, UPDATE ("state", "closed_at") ON "cases"."rule_report" TO cases_definer;
--> statement-breakpoint
-- The open reports counted per requirement and reason, without a note, a case or a reporter.
CREATE FUNCTION "cases"."open_rule_reports"()
  RETURNS TABLE (route_id text, version_number integer, requirement_id text, reason text, reports bigint)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT r.route_id, r.version_number, r.requirement_id, r.reason, pg_catalog.count(*)
      FROM "cases"."rule_report" r
     WHERE r.state = 'open'
     GROUP BY r.route_id, r.version_number, r.requirement_id, r.reason
     ORDER BY r.route_id, r.version_number, r.requirement_id, r.reason
  $$;
--> statement-breakpoint
-- Closes the open reports of one requirement of a version, or of every requirement when
-- requirement is null (a correction of the version was activated); answers how many it closed.
CREATE FUNCTION "cases"."close_rule_reports"(route text, version integer, requirement text)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    closed integer;
  BEGIN
    UPDATE "cases"."rule_report" r SET state = 'closed', closed_at = pg_catalog.now()
     WHERE r.state = 'open' AND r.route_id = route AND r.version_number = version
       AND (requirement IS NULL OR r.requirement_id = requirement);
    GET DIAGNOSTICS closed = ROW_COUNT;
    RETURN closed;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "cases"."open_rule_reports"() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "cases"."close_rule_reports"(text, integer, text) FROM PUBLIC;
--> statement-breakpoint
-- Granted while the migrator still owns them, since only the owner may grant.
GRANT EXECUTE ON FUNCTION "cases"."open_rule_reports"() TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "cases"."close_rule_reports"(text, integer, text) TO app_api;
--> statement-breakpoint
-- ALTER ... OWNER needs the new owner to hold CREATE on the schema; it holds it only meanwhile.
GRANT CREATE ON SCHEMA "cases" TO cases_definer;
--> statement-breakpoint
ALTER FUNCTION "cases"."open_rule_reports"() OWNER TO cases_definer;
--> statement-breakpoint
ALTER FUNCTION "cases"."close_rule_reports"(text, integer, text) OWNER TO cases_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "cases" FROM cases_definer;
