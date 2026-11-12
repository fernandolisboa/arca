-- The corrector listing also names, for a file, the cited page it is a copy of (ADR-0029, page
-- copies), so the run knows what each copy stands for. corrector_requests stays, unused, since
-- only its owner could replace it.
CREATE FUNCTION "knowledge"."corrector_request_list"(key uuid, digest bytea)
  RETURNS TABLE (id uuid, route_id text, version_number integer, item_kind text, item_key text,
                 note text, created_at timestamptz, sources jsonb, events jsonb)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  #variable_conflict use_column
  BEGIN
    IF NOT "knowledge"."corrector_key_holds"(key, digest) THEN
      RAISE EXCEPTION 'only the live corrector key reads requests' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT r.id, r.route_id, r.version_number, r.item_kind, r.item_key, r.note, r.created_at,
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
REVOKE ALL ON FUNCTION "knowledge"."corrector_request_list"(uuid, bytea) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."corrector_request_list"(uuid, bytea) TO app_api;
--> statement-breakpoint
GRANT CREATE ON SCHEMA "knowledge" TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."corrector_request_list"(uuid, bytea) OWNER TO knowledge_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "knowledge" FROM knowledge_definer;
