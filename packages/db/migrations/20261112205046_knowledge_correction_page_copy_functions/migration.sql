-- A file on a correction request may name the official page it is a copy of (ADR-0029, page
-- copies). Filing attaches files through a function that also takes that page; the #415 function
-- stays, unused, since only its owner could replace it. Admins list each file's page with its type
-- and size; the independent check, on the app_jobs pool with no account, reads the newest stored
-- copy of each page it cites.
CREATE FUNCTION "knowledge"."attach_correction_file_with_page"(request uuid, position_arg integer, upload uuid, page text, basis text)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    author uuid := nullif(pg_catalog.current_setting('app.account_id', true), '')::uuid;
  BEGIN
    IF basis IS DISTINCT FROM 'owner_list' OR NOT "knowledge"."admin_basis_holds"(basis, NULL) THEN
      RAISE EXCEPTION 'only an owner-list admin files a correction request' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
         SELECT FROM "knowledge"."correction_request" r
          WHERE r.id = request AND r.author_account_id = author AND r.created_at >= pg_catalog.now())
       OR NOT EXISTS (
         SELECT FROM "knowledge"."correction_upload" u
          WHERE u.id = upload AND u.author_account_id = author) THEN
      RAISE EXCEPTION 'a file goes on a request being filed, from an upload of its author'
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO "knowledge"."correction_source" (request_id, position, kind, upload_id, page_url)
      VALUES (request, position_arg, 'file', upload, page);
  END
  $$;
--> statement-breakpoint
-- The type, size and page of each file source of one version's requests, for an admin.
CREATE FUNCTION "knowledge"."correction_file_sources"(route text, version integer, basis text, grant_id uuid)
  RETURNS TABLE (request_id uuid, "position" integer, media_type text, size integer, page_url text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF NOT "knowledge"."admin_basis_holds"(basis, grant_id) THEN
      RAISE EXCEPTION 'only an admin reads correction requests' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT s.request_id, s.position, u.media_type, u.size, s.page_url
        FROM "knowledge"."correction_source" s
        JOIN "knowledge"."correction_upload" u ON u.id = s.upload_id
        JOIN "knowledge"."correction_request" r ON r.id = s.request_id
       WHERE r.route_id = route AND r.version_number = version;
  END
  $$;
--> statement-breakpoint
-- The newest stored copy of each of these pages, for the independent check: where it is, its
-- type, size and SHA-256. Never a request's note, text or author.
CREATE FUNCTION "knowledge"."correction_page_copies"(pages text[])
  RETURNS TABLE (page_url text, pathname text, media_type text, size integer, sha256 bytea)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT DISTINCT ON (s.page_url) s.page_url, u.pathname, u.media_type, u.size, u.sha256
      FROM "knowledge"."correction_source" s
      JOIN "knowledge"."correction_upload" u ON u.id = s.upload_id
      JOIN "knowledge"."correction_request" r ON r.id = s.request_id
     WHERE s.page_url = ANY (pages)
     ORDER BY s.page_url, r.created_at DESC, s.position DESC
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."attach_correction_file_with_page"(uuid, integer, uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."correction_file_sources"(text, integer, text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."correction_page_copies"(text[]) FROM PUBLIC;
--> statement-breakpoint
-- Granted while the migrator still owns them, since only the owner may grant.
GRANT EXECUTE ON FUNCTION "knowledge"."attach_correction_file_with_page"(uuid, integer, uuid, text, text) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."correction_file_sources"(text, integer, text, uuid) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."correction_page_copies"(text[]) TO app_jobs;
--> statement-breakpoint
-- ALTER ... OWNER needs the new owner to hold CREATE on the schema; it holds it only meanwhile.
GRANT CREATE ON SCHEMA "knowledge" TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."attach_correction_file_with_page"(uuid, integer, uuid, text, text) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."correction_file_sources"(text, integer, text, uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."correction_page_copies"(text[]) OWNER TO knowledge_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "knowledge" FROM knowledge_definer;
