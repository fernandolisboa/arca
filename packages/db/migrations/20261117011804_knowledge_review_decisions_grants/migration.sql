-- Review of a proposal (ADR-0031, #460). A decision is stored only as an `admin_step_up` row: app_auth
-- names the copied step-up fields again, the admin basis and the cases hash, and the insert policy
-- requires the author's own spent `knowledge_decision` step-up with the same fields, so no decision
-- is stored on a session alone. Older rows keep counting as they say.
GRANT INSERT ("credential_id", "public_key", "action_nonce", "server_nonce", "authenticator_data", "client_data_json", "signature", "step_up_id", "cases_hash") ON "knowledge"."decision" TO app_auth;
--> statement-breakpoint
-- app_jobs stores an ended request's proposal as a route version that names the request.
GRANT INSERT ("route_id", "number", "content", "content_hash", "cases", "request_id") ON "knowledge"."route_version" TO app_jobs;
--> statement-breakpoint
ALTER TABLE "knowledge"."version_edit" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "knowledge"."version_edit" FROM app_migrator;
--> statement-breakpoint
GRANT SELECT ON "knowledge"."version_edit" TO app_api;
--> statement-breakpoint
GRANT SELECT ("route_id", "number") ON "knowledge"."route_version" TO knowledge_definer;
--> statement-breakpoint
GRANT INSERT ("route_id", "number", "content", "content_hash", "cases") ON "knowledge"."route_version" TO knowledge_definer;
--> statement-breakpoint
GRANT INSERT ("route_id", "number", "item_key", "url", "quote") ON "knowledge"."version_edit" TO knowledge_definer;
--> statement-breakpoint
-- An admin, the transaction's account, stores a version they edited by hand, which the API checked
-- in code as it checks a proposal: under the update requests' lock per route, refused while a
-- request of the route is live, so a request's proposal and an edit never take the same number;
-- the number must follow the route's newest version, and the version it corrects must exist.
-- Answers 'stored', 'live' or 'taken'. The read re-checks the hash, as for every row.
CREATE FUNCTION "knowledge"."edit_route_version"(route_arg text, number_arg integer, corrects_arg integer, content_arg jsonb, hash_arg text, cases_arg jsonb, item_key_arg text, url_arg text, quote_arg text, basis text, grant_id uuid)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF NOT "knowledge"."admin_basis_holds"(basis, grant_id) THEN
      RAISE EXCEPTION 'only an admin edits a rule version' USING ERRCODE = '42501';
    END IF;
    IF content_arg ->> 'routeId' IS DISTINCT FROM route_arg
       OR (content_arg ->> 'number') IS DISTINCT FROM number_arg::text
       OR (content_arg ->> 'corrects') IS DISTINCT FROM corrects_arg::text THEN
      RAISE EXCEPTION 'the content names another version' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('knowledge.update_request:' || route_arg, 0));
    IF EXISTS (SELECT FROM "knowledge"."update_request" r
                WHERE r.route_id = route_arg
                  AND r.requested_at > pg_catalog.clock_timestamp() - interval '1 hour'
                  AND NOT EXISTS (SELECT FROM "knowledge"."update_end" e WHERE e.request_id = r.id)) THEN
      RETURN 'live';
    END IF;
    IF number_arg IS DISTINCT FROM (SELECT pg_catalog.max(v.number) + 1 FROM "knowledge"."route_version" v
                                     WHERE v.route_id = route_arg)
       OR NOT EXISTS (SELECT FROM "knowledge"."route_version" v
                       WHERE v.route_id = route_arg AND v.number = corrects_arg) THEN
      RETURN 'taken';
    END IF;
    INSERT INTO "knowledge"."route_version" (route_id, number, content, content_hash, cases)
      VALUES (route_arg, number_arg, content_arg, hash_arg, cases_arg);
    INSERT INTO "knowledge"."version_edit" (route_id, number, item_key, url, quote)
      VALUES (route_arg, number_arg, item_key_arg, url_arg, quote_arg);
    RETURN 'stored';
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."edit_route_version"(text, integer, integer, jsonb, text, jsonb, text, text, text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
-- Granted while the migrator still owns it, since only the owner may grant.
GRANT EXECUTE ON FUNCTION "knowledge"."edit_route_version"(text, integer, integer, jsonb, text, jsonb, text, text, text, text, uuid) TO app_api;
--> statement-breakpoint
-- ALTER ... OWNER needs the new owner to hold CREATE on the schema; it holds it only meanwhile.
GRANT CREATE ON SCHEMA "knowledge" TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."edit_route_version"(text, integer, integer, jsonb, text, jsonb, text, text, text, text, uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "knowledge" FROM knowledge_definer;
