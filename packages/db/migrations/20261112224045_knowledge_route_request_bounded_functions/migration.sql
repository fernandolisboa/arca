-- The fifty newest requests for a new route, newest first, as route_requests serves them
-- (which stays, unbounded, since only its owner could replace it), for an admin.
CREATE FUNCTION "knowledge"."newest_route_requests"(basis text, grant_id uuid)
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
-- As answer_route_request (which stays, since only its owner could replace it), but the route must
-- be in the request's country and the version its first: the run writes a new route at version 1.
CREATE FUNCTION "knowledge"."answer_new_route_request"(key uuid, digest bytea, request uuid, route text, proposed integer)
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
    IF proposed IS DISTINCT FROM 1
       OR NOT EXISTS (SELECT FROM "knowledge"."correction_request" r
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
REVOKE ALL ON FUNCTION "knowledge"."newest_route_requests"(text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."answer_new_route_request"(uuid, bytea, uuid, text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."newest_route_requests"(text, uuid) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."answer_new_route_request"(uuid, bytea, uuid, text, integer) TO app_api;
--> statement-breakpoint
-- ALTER ... OWNER needs the new owner to hold CREATE on the schema; it holds it only meanwhile.
GRANT CREATE ON SCHEMA "knowledge" TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."newest_route_requests"(text, uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."answer_new_route_request"(uuid, bytea, uuid, text, integer) OWNER TO knowledge_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "knowledge" FROM knowledge_definer;
