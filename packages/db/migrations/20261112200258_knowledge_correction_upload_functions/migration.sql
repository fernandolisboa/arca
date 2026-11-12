-- Files on correction requests and the retention step (ADR-0029). An owner-list admin starts an
-- upload through a definer function, which records the declared type, size and SHA-256 under a
-- random `corrections/` pathname; filing names the upload in a `file` source, once, through a
-- function of its own, since the #414 functions stay as they are (only their owner could replace
-- them, and a migration never changes role). app_api still
-- holds no table privileges. app_jobs, under the author's identity, deletes uploads no request
-- names, and erases a request's contents: it clears the note and deletes its sources and uploads.
ALTER TABLE "knowledge"."correction_upload" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON "knowledge"."correction_upload" TO knowledge_definer;
--> statement-breakpoint
GRANT SELECT, DELETE ON "knowledge"."correction_upload" TO app_jobs;
--> statement-breakpoint
GRANT DELETE ON "knowledge"."correction_source" TO app_jobs;
--> statement-breakpoint
GRANT UPDATE ("note", "content_erased_at") ON "knowledge"."correction_request" TO app_jobs;
--> statement-breakpoint
-- Starts an upload for the transaction's account, an owner-list admin: answers its ID and the
-- random pathname the grant is for. The table checks bound the type, size and digest.
CREATE FUNCTION "knowledge"."start_correction_upload"(media_type_arg text, size_arg integer, sha256_arg bytea, basis text)
  RETURNS TABLE (id uuid, pathname text)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  #variable_conflict use_column
  BEGIN
    IF basis IS DISTINCT FROM 'owner_list' OR NOT "knowledge"."admin_basis_holds"(basis, NULL) THEN
      RAISE EXCEPTION 'only an owner-list admin uploads a correction file' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      INSERT INTO "knowledge"."correction_upload" (author_account_id, pathname, media_type, size, sha256)
        VALUES (nullif(pg_catalog.current_setting('app.account_id', true), '')::uuid,
                'corrections/' || pg_catalog.gen_random_uuid()::text, media_type_arg, size_arg, sha256_arg)
        RETURNING id, pathname;
  END
  $$;
--> statement-breakpoint
-- The transaction's account's own upload that no request names yet, by ID or by pathname.
CREATE FUNCTION "knowledge"."own_correction_upload"(upload uuid, path text)
  RETURNS TABLE (id uuid, pathname text, media_type text, size integer, sha256 bytea, created_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT u.id, u.pathname, u.media_type, u.size, u.sha256, u.created_at
      FROM "knowledge"."correction_upload" u
     WHERE u.author_account_id = nullif(pg_catalog.current_setting('app.account_id', true), '')::uuid
       AND (u.id = upload OR u.pathname = path)
       AND NOT EXISTS (SELECT FROM "knowledge"."correction_source" s WHERE s.upload_id = u.id)
  $$;
--> statement-breakpoint
-- Adds a file source to a request the transaction's account filed in this same transaction,
-- naming an upload of that account; filing calls it after `file_correction_request`, whose own
-- sources take the positions before. The table checks bound the position, and an upload is named
-- once.
CREATE FUNCTION "knowledge"."attach_correction_file"(request uuid, position_arg integer, upload uuid, basis text)
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
    INSERT INTO "knowledge"."correction_source" (request_id, position, kind, upload_id)
      VALUES (request, position_arg, 'file', upload);
  END
  $$;
--> statement-breakpoint
-- The type and size of each file source of one version's requests, for an admin; the requests
-- themselves come from `correction_requests`.
CREATE FUNCTION "knowledge"."correction_files"(route text, version integer, basis text, grant_id uuid)
  RETURNS TABLE (request_id uuid, "position" integer, media_type text, size integer)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF NOT "knowledge"."admin_basis_holds"(basis, grant_id) THEN
      RAISE EXCEPTION 'only an admin reads correction requests' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT s.request_id, s.position, u.media_type, u.size
        FROM "knowledge"."correction_source" s
        JOIN "knowledge"."correction_upload" u ON u.id = s.upload_id
        JOIN "knowledge"."correction_request" r ON r.id = s.request_id
       WHERE r.route_id = route AND r.version_number = version;
  END
  $$;
--> statement-breakpoint
-- The stored pathname of one file source, for an admin; null when there is none.
CREATE FUNCTION "knowledge"."correction_file"(request uuid, position_arg integer, basis text, grant_id uuid)
  RETURNS text
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF NOT "knowledge"."admin_basis_holds"(basis, grant_id) THEN
      RAISE EXCEPTION 'only an admin opens correction files' USING ERRCODE = '42501';
    END IF;
    RETURN (SELECT u.pathname
              FROM "knowledge"."correction_source" s
              JOIN "knowledge"."correction_upload" u ON u.id = s.upload_id
             WHERE s.request_id = request AND s.position = position_arg);
  END
  $$;
--> statement-breakpoint
-- The transaction's account's own correction uploads, with the columns the data export registry
-- lists for them (spec 0004, R8), one JSON object per row; nothing for another table.
CREATE FUNCTION "knowledge"."own_correction_upload_rows"(entry text)
  RETURNS SETOF jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT pg_catalog.jsonb_build_object('media_type', u.media_type, 'size', u.size,
             'created_at', u.created_at)
      FROM "knowledge"."correction_upload" u
     WHERE entry = 'knowledge.correction_upload'
       AND u.author_account_id = nullif(pg_catalog.current_setting('app.account_id', true), '')::uuid
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."start_correction_upload"(text, integer, bytea, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."own_correction_upload"(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."attach_correction_file"(uuid, integer, uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."correction_files"(text, integer, text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."correction_file"(uuid, integer, text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."own_correction_upload_rows"(text) FROM PUBLIC;
--> statement-breakpoint
-- Granted while the migrator still owns them, since only the owner may grant.
GRANT EXECUTE ON FUNCTION "knowledge"."start_correction_upload"(text, integer, bytea, text) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."own_correction_upload"(uuid, text) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."attach_correction_file"(uuid, integer, uuid, text) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."correction_files"(text, integer, text, uuid) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."correction_file"(uuid, integer, text, uuid) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."own_correction_upload_rows"(text) TO app_api;
--> statement-breakpoint
-- ALTER ... OWNER needs the new owner to hold CREATE on the schema; it holds it only meanwhile.
GRANT CREATE ON SCHEMA "knowledge" TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."start_correction_upload"(text, integer, bytea, text) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."own_correction_upload"(uuid, text) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."attach_correction_file"(uuid, integer, uuid, text) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."correction_files"(text, integer, text, uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."correction_file"(uuid, integer, text, uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."own_correction_upload_rows"(text) OWNER TO knowledge_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "knowledge" FROM knowledge_definer;
