-- Members' update requests (ADR-0031, #462), stored as correction requests of kind `update`. Any
-- signed-in account files one on a route version it sees, with an optional note, links and files;
-- it waits until an admin releases it, which starts an update request of the route in the same
-- transaction, or declines it with an optional reason. One open member request per route, and none
-- while an update request of the route runs. A member's file names no page, so the independent
-- check never reads it. These functions are new, since only their owner could replace the
-- ADR-0029 ones, and a migration never changes role.
GRANT SELECT ("failure") ON "knowledge"."update_end" TO knowledge_definer;
--> statement-breakpoint
-- Whether a member's request is still open: no admin released or declined it.
CREATE FUNCTION "knowledge"."member_request_open"(request uuid)
  RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT NOT EXISTS (SELECT FROM "knowledge"."correction_event" e
                        WHERE e.request_id = request AND e.kind IN ('released', 'declined'))
  $$;
--> statement-breakpoint
-- Files a member's update request by the transaction's account, with its links in order; answers
-- its ID, or null while a member's request of the route is open or an update request of the route
-- runs (no end, made within the last hour), under the lock start_update_request takes.
CREATE FUNCTION "knowledge"."file_update_request"(route_arg text, version_arg integer, note_arg text, links jsonb)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    author uuid := nullif(pg_catalog.current_setting('app.account_id', true), '')::uuid;
    filed uuid;
  BEGIN
    IF author IS NULL THEN
      RAISE EXCEPTION 'an update request names its author' USING ERRCODE = '42501';
    END IF;
    IF pg_catalog.jsonb_typeof(links) IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(links) > 5
       OR EXISTS (SELECT FROM pg_catalog.jsonb_array_elements(links) l
                   WHERE pg_catalog.jsonb_typeof(l) IS DISTINCT FROM 'string') THEN
      RAISE EXCEPTION 'an update request has at most five links' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('knowledge.update_request:' || route_arg, 0));
    IF EXISTS (SELECT FROM "knowledge"."correction_request" r
                WHERE r.route_id = route_arg AND r.request_kind = 'update'
                  AND "knowledge"."member_request_open"(r.id))
       OR EXISTS (SELECT FROM "knowledge"."update_request" u
                   WHERE u.route_id = route_arg
                     AND u.requested_at > pg_catalog.clock_timestamp() - interval '1 hour'
                     AND NOT EXISTS (SELECT FROM "knowledge"."update_end" e WHERE e.request_id = u.id)) THEN
      RETURN NULL;
    END IF;
    INSERT INTO "knowledge"."correction_request"
        (route_id, version_number, item_kind, note, author_account_id, request_kind)
      VALUES (route_arg, version_arg, 'version', note_arg, author, 'update')
      RETURNING id INTO filed;
    INSERT INTO "knowledge"."correction_source" (request_id, position, kind, url)
      SELECT filed, (l.ordinality - 1)::integer, 'link', l.value #>> '{}'
        FROM pg_catalog.jsonb_array_elements(links) WITH ORDINALITY AS l(value, ordinality);
    RETURN filed;
  END
  $$;
--> statement-breakpoint
-- Starts an upload for the transaction's account, any signed-in account: answers its ID and the
-- random pathname the grant is for. The table checks bound the type, size and digest.
CREATE FUNCTION "knowledge"."start_update_upload"(media_type_arg text, size_arg integer, sha256_arg bytea)
  RETURNS TABLE (id uuid, pathname text)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  #variable_conflict use_column
  DECLARE
    author uuid := nullif(pg_catalog.current_setting('app.account_id', true), '')::uuid;
  BEGIN
    IF author IS NULL THEN
      RAISE EXCEPTION 'an upload names its author' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      INSERT INTO "knowledge"."correction_upload" (author_account_id, pathname, media_type, size, sha256)
        VALUES (author, 'corrections/' || pg_catalog.gen_random_uuid()::text, media_type_arg, size_arg, sha256_arg)
        RETURNING id, pathname;
  END
  $$;
--> statement-breakpoint
-- Adds a file to a member's update request the transaction's account files in this same
-- transaction, naming an upload of that account, after its links, among its five sources. It names
-- no page, so the independent check's page copies never include it.
CREATE FUNCTION "knowledge"."attach_update_file"(request uuid, position_arg integer, upload uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    author uuid := nullif(pg_catalog.current_setting('app.account_id', true), '')::uuid;
  BEGIN
    IF position_arg NOT BETWEEN 0 AND 4
       OR NOT EXISTS (
         SELECT FROM "knowledge"."correction_request" r
          WHERE r.id = request AND r.author_account_id = author AND r.request_kind = 'update'
            AND r.created_at >= pg_catalog.now())
       OR NOT EXISTS (
         SELECT FROM "knowledge"."correction_upload" u
          WHERE u.id = upload AND u.author_account_id = author) THEN
      RAISE EXCEPTION 'a file goes on an update request being filed, from an upload of its author'
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO "knowledge"."correction_source" (request_id, position, kind, upload_id)
      VALUES (request, position_arg, 'file', upload);
  END
  $$;
--> statement-breakpoint
-- A request's events with what a release started: its update request, when it was asked for,
-- whether it ended and whether it failed. Called by the functions below as their owner only.
CREATE FUNCTION "knowledge"."member_request_events"(request uuid)
  RETURNS jsonb
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
             'kind', e.kind, 'at', e.at, 'reason', e.explanation,
             'updateRequestId', e.update_request_id, 'requestedAt', u.requested_at,
             'ended', CASE WHEN u.id IS NULL THEN NULL ELSE ended.request_id IS NOT NULL END,
             'failed', CASE WHEN ended.request_id IS NULL THEN NULL ELSE ended.failure IS NOT NULL END))
             ORDER BY e.at), '[]'::jsonb)
      FROM "knowledge"."correction_event" e
      LEFT JOIN "knowledge"."update_request" u ON u.id = e.update_request_id
      LEFT JOIN "knowledge"."update_end" ended ON ended.request_id = u.id
     WHERE e.request_id = request AND e.kind IN ('released', 'declined')
  $$;
--> statement-breakpoint
-- The newest 50 members' update requests, or only the one named, with their links, their files' type
-- and size, and their events, for an admin.
CREATE FUNCTION "knowledge"."member_update_requests"(basis text, grant_id uuid, only_id uuid)
  RETURNS TABLE (id uuid, route_id text, version_number integer, note text, created_at timestamptz,
                 erased boolean, sources jsonb, events jsonb)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  #variable_conflict use_column
  BEGIN
    IF NOT "knowledge"."admin_basis_holds"(basis, grant_id) THEN
      RAISE EXCEPTION 'only an admin reads members'' update requests' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT r.id, r.route_id, r.version_number, r.note, r.created_at,
             r.content_erased_at IS NOT NULL,
             coalesce((SELECT pg_catalog.jsonb_agg(
                         CASE WHEN s.kind = 'file'
                              THEN pg_catalog.jsonb_build_object('kind', s.kind,
                                     'mediaType', u.media_type, 'size', u.size, 'pageUrl', NULL)
                              ELSE pg_catalog.jsonb_build_object('kind', s.kind, 'url', s.url)
                         END ORDER BY s.position)
                         FROM "knowledge"."correction_source" s
                         LEFT JOIN "knowledge"."correction_upload" u ON u.id = s.upload_id
                        WHERE s.request_id = r.id), '[]'::jsonb),
             "knowledge"."member_request_events"(r.id)
        FROM "knowledge"."correction_request" r
       WHERE r.request_kind = 'update' AND (only_id IS NULL OR r.id = only_id)
       ORDER BY r.created_at DESC, r.id
       LIMIT 50;
  END
  $$;
--> statement-breakpoint
-- Which of the given requests are members' update requests, so an admin's correction list and its
-- close action leave them out (the ADR-0029 readers predate the request kind).
CREATE FUNCTION "knowledge"."member_request_ids"(ids uuid[], basis text, grant_id uuid)
  RETURNS SETOF uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF NOT "knowledge"."admin_basis_holds"(basis, grant_id) THEN
      RAISE EXCEPTION 'only an admin reads members'' update requests' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT r.id FROM "knowledge"."correction_request" r
       WHERE r.id = ANY (ids) AND r.request_kind = 'update';
  END
  $$;
--> statement-breakpoint
-- The transaction's account's own newest 50 update requests with their events: never another's.
CREATE FUNCTION "knowledge"."own_update_requests"()
  RETURNS TABLE (id uuid, route_id text, version_number integer, created_at timestamptz, events jsonb)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT r.id, r.route_id, r.version_number, r.created_at, "knowledge"."member_request_events"(r.id)
      FROM "knowledge"."correction_request" r
     WHERE r.request_kind = 'update'
       AND r.author_account_id = nullif(pg_catalog.current_setting('app.account_id', true), '')::uuid
     ORDER BY r.created_at DESC, r.id
     LIMIT 50
  $$;
--> statement-breakpoint
-- An admin releases an open member's request, naming the update request of the same route that
-- start_update_request made in this same transaction: answers `released`, `decided` for one already
-- released or declined, or `missing`.
CREATE FUNCTION "knowledge"."release_update_request"(request uuid, update_id uuid, basis text, grant_id uuid)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    route text;
  BEGIN
    IF NOT "knowledge"."admin_basis_holds"(basis, grant_id) THEN
      RAISE EXCEPTION 'only an admin releases an update request' USING ERRCODE = '42501';
    END IF;
    SELECT r.route_id INTO route FROM "knowledge"."correction_request" r
     WHERE r.id = request AND r.request_kind = 'update';
    IF NOT FOUND THEN
      RETURN 'missing';
    END IF;
    IF NOT "knowledge"."member_request_open"(request) THEN
      RETURN 'decided';
    END IF;
    IF NOT EXISTS (SELECT FROM "knowledge"."update_request" u
                    WHERE u.id = update_id AND u.route_id = route
                      AND u.requested_at >= pg_catalog.now()) THEN
      RAISE EXCEPTION 'a release names the update request it started for the same route'
        USING ERRCODE = '22023';
    END IF;
    INSERT INTO "knowledge"."correction_event" (request_id, kind, update_request_id)
      VALUES (request, 'released', update_id);
    RETURN 'released';
  END
  $$;
--> statement-breakpoint
-- An admin declines a member's request, with an optional reason: an open one, or one whose release
-- ended with no proposal (failed, or no end an hour after it was asked for). Answers `declined`,
-- `decided` otherwise, or `missing`.
CREATE FUNCTION "knowledge"."decline_update_request"(request uuid, reason text, basis text, grant_id uuid)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    route text;
  BEGIN
    IF NOT "knowledge"."admin_basis_holds"(basis, grant_id) THEN
      RAISE EXCEPTION 'only an admin declines an update request' USING ERRCODE = '42501';
    END IF;
    SELECT r.route_id INTO route FROM "knowledge"."correction_request" r
     WHERE r.id = request AND r.request_kind = 'update';
    IF route IS NULL THEN
      RETURN 'missing';
    END IF;
    -- The release path holds this lock, so a release and a decline never both land.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('knowledge.update_request:' || route, 0));
    IF EXISTS (SELECT FROM "knowledge"."correction_event" e
                WHERE e.request_id = request AND e.kind = 'declined')
       OR EXISTS (SELECT FROM "knowledge"."correction_event" e
                    JOIN "knowledge"."update_request" u ON u.id = e.update_request_id
                    LEFT JOIN "knowledge"."update_end" ended ON ended.request_id = u.id
                   WHERE e.request_id = request AND e.kind = 'released'
                     AND CASE WHEN ended.request_id IS NOT NULL THEN ended.failure IS NULL
                              ELSE u.requested_at > pg_catalog.clock_timestamp() - interval '1 hour' END) THEN
      RETURN 'decided';
    END IF;
    INSERT INTO "knowledge"."correction_event" (request_id, kind, explanation)
      VALUES (request, 'declined', reason);
    RETURN 'declined';
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."member_request_open"(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."member_request_events"(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."file_update_request"(text, integer, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."start_update_upload"(text, integer, bytea) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."attach_update_file"(uuid, integer, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."member_update_requests"(text, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."member_request_ids"(uuid[], text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."own_update_requests"() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."release_update_request"(uuid, uuid, text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."decline_update_request"(uuid, text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
-- Granted while the migrator still owns them, since only the owner may grant.
GRANT EXECUTE ON FUNCTION "knowledge"."file_update_request"(text, integer, text, jsonb) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."start_update_upload"(text, integer, bytea) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."attach_update_file"(uuid, integer, uuid) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."member_update_requests"(text, uuid, uuid) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."member_request_ids"(uuid[], text, uuid) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."own_update_requests"() TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."release_update_request"(uuid, uuid, text, uuid) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."decline_update_request"(uuid, text, text, uuid) TO app_api;
--> statement-breakpoint
-- ALTER ... OWNER needs the new owner to hold CREATE on the schema; it holds it only meanwhile.
GRANT CREATE ON SCHEMA "knowledge" TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."member_request_open"(uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."member_request_events"(uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."file_update_request"(text, integer, text, jsonb) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."start_update_upload"(text, integer, bytea) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."attach_update_file"(uuid, integer, uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."member_update_requests"(text, uuid, uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."member_request_ids"(uuid[], text, uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."own_update_requests"() OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."release_update_request"(uuid, uuid, text, uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."decline_update_request"(uuid, text, text, uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "knowledge" FROM knowledge_definer;
