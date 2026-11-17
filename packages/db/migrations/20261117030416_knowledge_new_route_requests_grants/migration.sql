-- New-route requests (ADR-0031, #461). An admin asks for a new route of one country by naming the
-- visa or entry type; the request is inserted only through start_new_route_request, which
-- re-checks the admin basis and refuses a second live new-route request for the country under a
-- lock per country. app_jobs stores a new country's first official-domain list with the request
-- whose end holds its hash; app_auth stores a decision on such a list as an admin_step_up row.
GRANT INSERT ("list_id") ON "knowledge"."decision" TO app_auth;
--> statement-breakpoint
GRANT INSERT ("list_id", "number", "content", "content_hash", "request_id") ON "knowledge"."official_domain_list" TO app_jobs;
--> statement-breakpoint
GRANT INSERT ("list_hash") ON "knowledge"."update_end" TO app_jobs;
--> statement-breakpoint
GRANT SELECT ("country") ON "knowledge"."update_request" TO knowledge_definer;
--> statement-breakpoint
GRANT INSERT ("country", "visa", "links", "list_pins") ON "knowledge"."update_request" TO knowledge_definer;
--> statement-breakpoint
-- An admin, the transaction's account, asks for a new route of a country. A new-route request of
-- the country with no end, made within the last hour, is live, and a second one is refused: the
-- answer is then null. After an hour a request with no end counts as stalled and no longer blocks.
CREATE FUNCTION "knowledge"."start_new_route_request"(country_arg text, visa_arg text, links_arg text[], pins_arg text[], basis text, grant_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    stored uuid;
  BEGIN
    IF NOT "knowledge"."admin_basis_holds"(basis, grant_id) THEN
      RAISE EXCEPTION 'only an admin asks for a new route' USING ERRCODE = '42501';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('knowledge.new_route_request:' || country_arg, 0));
    IF EXISTS (SELECT FROM "knowledge"."update_request" r
                WHERE r.route_id IS NULL AND r.country = country_arg
                  AND r.requested_at > pg_catalog.clock_timestamp() - interval '1 hour'
                  AND NOT EXISTS (SELECT FROM "knowledge"."update_end" e WHERE e.request_id = r.id)) THEN
      RETURN NULL;
    END IF;
    INSERT INTO "knowledge"."update_request" (country, visa, links, list_pins)
      VALUES (country_arg, visa_arg, links_arg, pins_arg) RETURNING id INTO stored;
    RETURN stored;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."start_new_route_request"(text, text, text[], text[], text, uuid) FROM PUBLIC;
--> statement-breakpoint
-- Granted while the migrator still owns it, since only the owner may grant.
GRANT EXECUTE ON FUNCTION "knowledge"."start_new_route_request"(text, text, text[], text[], text, uuid) TO app_api;
--> statement-breakpoint
-- ALTER ... OWNER needs the new owner to hold CREATE on the schema; it holds it only meanwhile.
GRANT CREATE ON SCHEMA "knowledge" TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."start_new_route_request"(text, text, text[], text[], text, uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "knowledge" FROM knowledge_definer;
