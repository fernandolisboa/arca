-- Update requests (ADR-0031). A request is inserted only through start_update_request, owned by
-- knowledge_definer, which re-checks the admin basis and refuses a second live request for the
-- route under a lock per route. app_jobs inserts each stage's result, the request's end and the
-- validator's cached answers; app_api reads requests, stages and ends. Nobody updates or deletes.
ALTER TABLE "knowledge"."update_request" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge"."update_stage" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge"."update_end" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge"."rule_verdict" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- app_migrator owns the tables and gives up changing, deleting and truncating their rows.
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "knowledge"."update_request", "knowledge"."update_stage", "knowledge"."update_end", "knowledge"."rule_verdict" FROM app_migrator;
--> statement-breakpoint
GRANT SELECT ON "knowledge"."update_request", "knowledge"."update_stage", "knowledge"."update_end" TO app_api, app_jobs;
--> statement-breakpoint
GRANT INSERT ("request_id", "position", "stage", "failure", "needs_correction", "proposal_valid", "output", "model", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "web_searches") ON "knowledge"."update_stage" TO app_jobs;
--> statement-breakpoint
GRANT INSERT ("request_id", "failure", "content_hash", "proposal") ON "knowledge"."update_end" TO app_jobs;
--> statement-breakpoint
GRANT SELECT, INSERT ("cache_key", "verdict") ON "knowledge"."rule_verdict" TO app_jobs;
--> statement-breakpoint
GRANT SELECT ("id", "route_id", "requested_at") ON "knowledge"."update_request" TO knowledge_definer;
--> statement-breakpoint
GRANT SELECT ("request_id") ON "knowledge"."update_end" TO knowledge_definer;
--> statement-breakpoint
GRANT INSERT ("route_id", "base_number") ON "knowledge"."update_request" TO knowledge_definer;
--> statement-breakpoint
-- An admin, the transaction's account, asks for a route to be researched again. A request of the
-- route with no end, made within the last hour, is live, and a second one is refused: the answer
-- is then null. After an hour a request with no end counts as stalled and no longer blocks.
CREATE FUNCTION "knowledge"."start_update_request"(route_arg text, base_arg integer, basis text, grant_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    stored uuid;
  BEGIN
    IF NOT "knowledge"."admin_basis_holds"(basis, grant_id) THEN
      RAISE EXCEPTION 'only an admin asks for a rule update' USING ERRCODE = '42501';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('knowledge.update_request:' || route_arg, 0));
    IF EXISTS (SELECT FROM "knowledge"."update_request" r
                WHERE r.route_id = route_arg
                  AND r.requested_at > pg_catalog.clock_timestamp() - interval '1 hour'
                  AND NOT EXISTS (SELECT FROM "knowledge"."update_end" e WHERE e.request_id = r.id)) THEN
      RETURN NULL;
    END IF;
    INSERT INTO "knowledge"."update_request" (route_id, base_number)
      VALUES (route_arg, base_arg) RETURNING id INTO stored;
    RETURN stored;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."start_update_request"(text, integer, text, uuid) FROM PUBLIC;
--> statement-breakpoint
-- Granted while the migrator still owns it, since only the owner may grant.
GRANT EXECUTE ON FUNCTION "knowledge"."start_update_request"(text, integer, text, uuid) TO app_api;
--> statement-breakpoint
-- ALTER ... OWNER needs the new owner to hold CREATE on the schema; it holds it only meanwhile.
GRANT CREATE ON SCHEMA "knowledge" TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."start_update_request"(text, integer, text, uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "knowledge" FROM knowledge_definer;
