-- Requests for a new route (ADR-0029, new routes): an owner-list admin asks for a route the
-- catalog lacks in one country, with copies of its official pages and the passages that carry
-- each rule. They are correction requests that name a country instead of a version, so closing,
-- files, retention and erasure work as for any request. The functions below file and list them,
-- give the corrector run each request's country, and store an answer that names the new route's
-- version. The #414 and #416 functions stay as they are, since only their owner could replace them.
CREATE FUNCTION "knowledge"."file_route_request"(country text, note_arg text, sources jsonb, basis text)
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
       OR pg_catalog.jsonb_array_length(sources) > 20 THEN
      RAISE EXCEPTION 'a request for a new route has at most twenty sources' USING ERRCODE = '22023';
    END IF;
    INSERT INTO "knowledge"."correction_request" (country_code, item_kind, note, author_account_id)
      VALUES (country, 'newRoute', note_arg,
              nullif(pg_catalog.current_setting('app.account_id', true), '')::uuid)
      RETURNING id INTO filed;
    INSERT INTO "knowledge"."correction_source" (request_id, position, kind, url, text)
      SELECT filed, (s.ordinality - 1)::integer, s.value ->> 'kind', s.value ->> 'url', s.value ->> 'text'
        FROM pg_catalog.jsonb_array_elements(sources) WITH ORDINALITY AS s(value, ordinality);
    RETURN filed;
  END
  $$;
--> statement-breakpoint
-- The fifty newest requests for a new route, newest first, with their sources (a file with its type, size and
-- page) and events (an answer with its proposed route and version or its explanation), for an
-- admin.
CREATE FUNCTION "knowledge"."route_requests"(basis text, grant_id uuid)
  RETURNS TABLE (id uuid, country_code text, note text, created_at timestamptz, sources jsonb, events jsonb)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  #variable_conflict use_column
  BEGIN
    IF NOT "knowledge"."admin_basis_holds"(basis, grant_id) THEN
      RAISE EXCEPTION 'only an admin reads correction requests' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT r.id, r.country_code, r.note, r.created_at,
             coalesce((SELECT pg_catalog.jsonb_agg(
                         CASE WHEN s.kind = 'file'
                              THEN pg_catalog.jsonb_build_object('kind', s.kind,
                                     'mediaType', u.media_type, 'size', u.size, 'pageUrl', s.page_url)
                              ELSE pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                                     'kind', s.kind, 'url', s.url, 'text', s.text))
                         END ORDER BY s.position)
                         FROM "knowledge"."correction_source" s
                         LEFT JOIN "knowledge"."correction_upload" u ON u.id = s.upload_id
                        WHERE s.request_id = r.id), '[]'::jsonb),
             coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                         'kind', e.kind, 'proposedRouteId', e.proposed_route_id,
                         'proposedVersion', e.proposed_version, 'explanation', e.explanation))
                         ORDER BY e.at)
                         FROM "knowledge"."correction_event" e WHERE e.request_id = r.id), '[]'::jsonb)
        FROM "knowledge"."correction_request" r
       WHERE r.item_kind = 'newRoute'
       ORDER BY r.created_at DESC, r.id
       LIMIT 50;
  END
  $$;
--> statement-breakpoint
-- For the live key: every request no answer or close names, oldest first, as
-- corrector_request_list serves them, plus the country a request for a new route names.
CREATE FUNCTION "knowledge"."corrector_request_queue"(key uuid, digest bytea)
  RETURNS TABLE (id uuid, route_id text, version_number integer, country_code text, item_kind text,
                 item_key text, note text, created_at timestamptz, sources jsonb, events jsonb)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  #variable_conflict use_column
  BEGIN
    IF NOT "knowledge"."corrector_key_holds"(key, digest) THEN
      RAISE EXCEPTION 'only the live corrector key reads requests' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT r.id, r.route_id, r.version_number, r.country_code, r.item_kind, r.item_key, r.note,
             r.created_at,
             coalesce((SELECT pg_catalog.jsonb_agg(
                         CASE WHEN s.kind = 'file'
                              THEN pg_catalog.jsonb_build_object('kind', s.kind,
                                     'mediaType', u.media_type, 'size', u.size, 'pageUrl', s.page_url)
                              ELSE pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                                     'kind', s.kind, 'url', s.url, 'text', s.text))
                         END ORDER BY s.position)
                         FROM "knowledge"."correction_source" s
                         LEFT JOIN "knowledge"."correction_upload" u ON u.id = s.upload_id
                        WHERE s.request_id = r.id), '[]'::jsonb),
             coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind', e.kind) ORDER BY e.at)
                         FROM "knowledge"."correction_event" e WHERE e.request_id = r.id), '[]'::jsonb)
        FROM "knowledge"."correction_request" r
       WHERE NOT EXISTS (SELECT FROM "knowledge"."correction_event" e
                          WHERE e.request_id = r.id AND e.kind IN ('answered', 'closed'))
       ORDER BY r.created_at, r.id;
  END
  $$;
--> statement-breakpoint
-- For the live key: answers a taken request for a new route, which no answer or close names yet,
-- with the version proposed on the route the run wrote, in the request's country; the API checked
-- it against the catalog first. Taking such a request, or answering that nothing changed, goes through
-- answer_correction_request. Answers `stored`, `refused` for any other state, or `missing`.
CREATE FUNCTION "knowledge"."answer_route_request"(key uuid, digest bytea, request uuid, route text, proposed integer)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF NOT "knowledge"."corrector_key_holds"(key, digest) THEN
      RAISE EXCEPTION 'only the live corrector key answers requests' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT FROM "knowledge"."correction_request" r
                    WHERE r.id = request AND r.item_kind = 'newRoute') THEN
      RETURN 'missing';
    END IF;
    IF NOT EXISTS (SELECT FROM "knowledge"."correction_request" r
                    WHERE r.id = request AND pg_catalog.starts_with(route, r.country_code || '-')) THEN
      RETURN 'refused';
    END IF;
    IF NOT EXISTS (SELECT FROM "knowledge"."correction_event" e
                    WHERE e.request_id = request AND e.kind = 'taken')
       OR EXISTS (SELECT FROM "knowledge"."correction_event" e
                   WHERE e.request_id = request AND e.kind IN ('answered', 'closed')) THEN
      RETURN 'refused';
    END IF;
    INSERT INTO "knowledge"."correction_event"
        (request_id, kind, corrector_key_id, proposed_route_id, proposed_version)
      VALUES (request, 'answered', key, route, proposed)
      ON CONFLICT (request_id, kind) DO NOTHING;
    RETURN CASE WHEN FOUND THEN 'stored' ELSE 'refused' END;
  END
  $$;
--> statement-breakpoint
-- The transaction's account's own requests, with the columns the data export registry lists for
-- them (spec 0004, R8), the country of a request for a new route included; own_correction_rows
-- still serves their sources and events.
CREATE FUNCTION "knowledge"."own_correction_request_rows"(entry text)
  RETURNS SETOF jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT pg_catalog.jsonb_build_object('route_id', r.route_id, 'version_number', r.version_number,
             'country_code', r.country_code, 'item_kind', r.item_kind, 'item_key', r.item_key,
             'note', r.note, 'created_at', r.created_at)
      FROM "knowledge"."correction_request" r
     WHERE entry = 'knowledge.correction_request'
       AND r.author_account_id = nullif(pg_catalog.current_setting('app.account_id', true), '')::uuid
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."file_route_request"(text, text, jsonb, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."route_requests"(text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."corrector_request_queue"(uuid, bytea) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."answer_route_request"(uuid, bytea, uuid, text, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."own_correction_request_rows"(text) FROM PUBLIC;
--> statement-breakpoint
-- Granted while the migrator still owns them, since only the owner may grant.
GRANT EXECUTE ON FUNCTION "knowledge"."file_route_request"(text, text, jsonb, text) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."route_requests"(text, uuid) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."corrector_request_queue"(uuid, bytea) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."answer_route_request"(uuid, bytea, uuid, text, integer) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."own_correction_request_rows"(text) TO app_api;
--> statement-breakpoint
-- ALTER ... OWNER needs the new owner to hold CREATE on the schema; it holds it only meanwhile.
GRANT CREATE ON SCHEMA "knowledge" TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."file_route_request"(text, text, jsonb, text) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."route_requests"(text, uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."corrector_request_queue"(uuid, bytea) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."answer_route_request"(uuid, bytea, uuid, text, integer) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."own_correction_request_rows"(text) OWNER TO knowledge_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "knowledge" FROM knowledge_definer;
