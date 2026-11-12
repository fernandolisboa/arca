-- Correction requests (ADR-0029). app_api serves admins only through the definer functions below,
-- owned by knowledge_definer, which take the admin basis the API computed and check it again:
-- filing needs the owner list, which lives in code, so the database checks only that an account
-- is named; reading and closing need the owner list or a grant of the transaction's account that
-- no removal ended. app_api also reads the author's own rows for their data export, and app_jobs
-- reads and deletes them under the author's identity for erasure; sources and events go through
-- the cascades. Nobody updates a row.
ALTER TABLE "knowledge"."correction_request" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge"."correction_source" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge"."correction_event" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "knowledge" TO knowledge_definer;
--> statement-breakpoint
GRANT SELECT ON "knowledge"."admin_grant" TO knowledge_definer;
--> statement-breakpoint
GRANT SELECT, INSERT ON "knowledge"."correction_request", "knowledge"."correction_source", "knowledge"."correction_event" TO knowledge_definer;
--> statement-breakpoint
GRANT SELECT, DELETE ON "knowledge"."correction_request" TO app_jobs;
--> statement-breakpoint
GRANT SELECT ON "knowledge"."correction_source", "knowledge"."correction_event" TO app_jobs;
--> statement-breakpoint
GRANT SELECT ON "knowledge"."correction_request", "knowledge"."correction_source", "knowledge"."correction_event" TO app_api;
--> statement-breakpoint
-- Whether the transaction's account holds the admin basis it claims: the owner list, which only
-- the API can check, or a grant to it that no removal ended (ADR-0027). Called by the functions
-- below as their owner only.
CREATE FUNCTION "knowledge"."admin_basis_holds"(basis text, grant_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT nullif(pg_catalog.current_setting('app.account_id', true), '') IS NOT NULL
       AND CASE basis
         WHEN 'owner_list' THEN grant_id IS NULL
         WHEN 'grant' THEN EXISTS (
             SELECT FROM "knowledge"."admin_grant" g
              WHERE g.id = grant_id AND g.kind = 'grant'
                AND g.grantee_account_id = nullif(pg_catalog.current_setting('app.account_id', true), '')::uuid)
           AND NOT EXISTS (
             SELECT FROM "knowledge"."admin_grant" r
              WHERE r.kind = 'removal' AND r.removes_grant_id = grant_id)
         ELSE false END
  $$;
--> statement-breakpoint
-- Files a request by the transaction's account, an owner-list admin, with its sources in order;
-- answers its ID. The table checks bound every field.
CREATE FUNCTION "knowledge"."file_correction_request"(route text, version integer, item_kind_arg text, item_key_arg text, note_arg text, sources jsonb, basis text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    filed uuid;
  BEGIN
    IF basis IS DISTINCT FROM 'owner_list' OR NOT "knowledge"."admin_basis_holds"(basis, NULL) THEN
      RAISE EXCEPTION 'only an owner-list admin files a correction request' USING ERRCODE = '42501';
    END IF;
    IF pg_catalog.jsonb_typeof(sources) IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(sources) > 5 THEN
      RAISE EXCEPTION 'a correction request has at most five sources' USING ERRCODE = '22023';
    END IF;
    INSERT INTO "knowledge"."correction_request"
        (route_id, version_number, item_kind, item_key, note, author_account_id)
      VALUES (route, version, item_kind_arg, item_key_arg, note_arg,
              nullif(pg_catalog.current_setting('app.account_id', true), '')::uuid)
      RETURNING id INTO filed;
    INSERT INTO "knowledge"."correction_source" (request_id, position, kind, url, text)
      SELECT filed, (s.ordinality - 1)::integer, s.value ->> 'kind', s.value ->> 'url', s.value ->> 'text'
        FROM pg_catalog.jsonb_array_elements(sources) WITH ORDINALITY AS s(value, ordinality);
    RETURN filed;
  END
  $$;
--> statement-breakpoint
-- One version's requests, newest first, with their sources and events, for an admin.
CREATE FUNCTION "knowledge"."correction_requests"(route text, version integer, basis text, grant_id uuid)
  RETURNS TABLE (id uuid, item_kind text, item_key text, note text, created_at timestamptz, sources jsonb, events jsonb)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  #variable_conflict use_column
  BEGIN
    IF NOT "knowledge"."admin_basis_holds"(basis, grant_id) THEN
      RAISE EXCEPTION 'only an admin reads correction requests' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT r.id, r.item_kind, r.item_key, r.note, r.created_at,
             coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                         'kind', s.kind, 'url', s.url, 'text', s.text)) ORDER BY s.position)
                         FROM "knowledge"."correction_source" s WHERE s.request_id = r.id), '[]'::jsonb),
             coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind', e.kind) ORDER BY e.at)
                         FROM "knowledge"."correction_event" e WHERE e.request_id = r.id), '[]'::jsonb)
        FROM "knowledge"."correction_request" r
       WHERE r.route_id = route AND r.version_number = version
       ORDER BY r.created_at DESC, r.id;
  END
  $$;
--> statement-breakpoint
-- An admin closes a request: answers `closed`, `unchanged` for one already closed, or `missing`.
CREATE FUNCTION "knowledge"."close_correction_request"(request uuid, basis text, grant_id uuid)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF NOT "knowledge"."admin_basis_holds"(basis, grant_id) THEN
      RAISE EXCEPTION 'only an admin closes correction requests' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT FROM "knowledge"."correction_request" r WHERE r.id = request) THEN
      RETURN 'missing';
    END IF;
    INSERT INTO "knowledge"."correction_event" (request_id, kind)
      VALUES (request, 'closed') ON CONFLICT (request_id, kind) DO NOTHING;
    RETURN CASE WHEN FOUND THEN 'closed' ELSE 'unchanged' END;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."admin_basis_holds"(text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."file_correction_request"(text, integer, text, text, text, jsonb, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."correction_requests"(text, integer, text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."close_correction_request"(uuid, text, uuid) FROM PUBLIC;
--> statement-breakpoint
-- Granted while the migrator still owns them, since only the owner may grant.
GRANT EXECUTE ON FUNCTION "knowledge"."file_correction_request"(text, integer, text, text, text, jsonb, text) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."correction_requests"(text, integer, text, uuid) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."close_correction_request"(uuid, text, uuid) TO app_api;
--> statement-breakpoint
-- ALTER ... OWNER needs the new owner to hold CREATE on the schema; it holds it only meanwhile.
GRANT CREATE ON SCHEMA "knowledge" TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."admin_basis_holds"(text, uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."file_correction_request"(text, integer, text, text, text, jsonb, text) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."correction_requests"(text, integer, text, uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."close_correction_request"(uuid, text, uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "knowledge" FROM knowledge_definer;
