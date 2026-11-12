-- The corrector key and the corrector run's answers (ADR-0029). app_auth inserts a created key,
-- spending a corrector_key step-up, under the insert policy; everything else goes through the
-- definer functions below, owned by knowledge_definer. app_api reads the live key's ID, digest,
-- creator and date to compare a presented key in constant time and to show its dates; every
-- function the key opens re-checks that the key it is given is the live one with that digest.
-- app_api still holds no table privileges on the request tables or the key table.
ALTER TABLE "knowledge"."corrector_key" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON "knowledge"."corrector_key" TO knowledge_definer;
--> statement-breakpoint
GRANT INSERT ON "knowledge"."corrector_key" TO app_auth;
--> statement-breakpoint
-- The live corrector key: the newest created key, unless a revocation ended it or it is a year
-- old. The API checks too that its creator is still on the owner list and still has an account.
CREATE FUNCTION "knowledge"."live_corrector_key"()
  RETURNS TABLE (id uuid, key_sha256 bytea, actor_account_id uuid, created_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT k.id, k.key_sha256, k.actor_account_id, k.at
      FROM "knowledge"."corrector_key" k
     WHERE k.id = (SELECT n.id FROM "knowledge"."corrector_key" n
                    WHERE n.kind = 'created' ORDER BY n.at DESC, n.id DESC LIMIT 1)
       AND k.at > pg_catalog.now() - pg_catalog.make_interval(years => 1)
       AND NOT EXISTS (SELECT FROM "knowledge"."corrector_key" r WHERE r.revokes_key_id = k.id)
  $$;
--> statement-breakpoint
-- Whether a key the API matched is still the live one with that digest. Called by the functions
-- below as their owner only.
CREATE FUNCTION "knowledge"."corrector_key_holds"(key uuid, digest bytea)
  RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT EXISTS (SELECT FROM "knowledge"."live_corrector_key"() l
                    WHERE l.id = key AND l.key_sha256 = digest)
  $$;
--> statement-breakpoint
-- An owner-list admin, the transaction's account, revokes the live key it names; answers whether
-- a revocation was stored.
CREATE FUNCTION "knowledge"."revoke_corrector_key"(key uuid, basis text)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF basis IS DISTINCT FROM 'owner_list' OR NOT "knowledge"."admin_basis_holds"(basis, NULL) THEN
      RAISE EXCEPTION 'only an owner-list admin revokes the corrector key' USING ERRCODE = '42501';
    END IF;
    INSERT INTO "knowledge"."corrector_key" (kind, revokes_key_id, actor_account_id)
      SELECT 'revoked', l.id, nullif(pg_catalog.current_setting('app.account_id', true), '')::uuid
        FROM "knowledge"."live_corrector_key"() l WHERE l.id = key
      ON CONFLICT (revokes_key_id) DO NOTHING;
    RETURN FOUND;
  END
  $$;
--> statement-breakpoint
-- For the live key: every request no one answered or closed, oldest first, with its sources, a
-- file as its type and size, and its events. The API computes each one's state from the catalog.
CREATE FUNCTION "knowledge"."corrector_requests"(key uuid, digest bytea)
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
             coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                         'kind', s.kind, 'url', s.url, 'text', s.text,
                         'mediaType', u.media_type, 'size', u.size)) ORDER BY s.position)
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
-- For the live key: the stored pathname of one file source of a request no one answered or
-- closed; null when there is none.
CREATE FUNCTION "knowledge"."corrector_file"(key uuid, digest bytea, request uuid, position_arg integer)
  RETURNS text
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF NOT "knowledge"."corrector_key_holds"(key, digest) THEN
      RAISE EXCEPTION 'only the live corrector key opens request files' USING ERRCODE = '42501';
    END IF;
    RETURN (SELECT u.pathname
              FROM "knowledge"."correction_source" s
              JOIN "knowledge"."correction_upload" u ON u.id = s.upload_id
             WHERE s.request_id = request AND s.position = position_arg
               AND NOT EXISTS (SELECT FROM "knowledge"."correction_event" e
                                WHERE e.request_id = request AND e.kind IN ('answered', 'closed')));
  END
  $$;
--> statement-breakpoint
-- For the live key: takes a request no event names yet, or answers a taken one no answer or close
-- names, with a proposed version or an explanation; the API checked the answer against the
-- catalog first. Answers `stored`, `refused` for any other state, or `missing`.
CREATE FUNCTION "knowledge"."answer_correction_request"(key uuid, digest bytea, request uuid, kind_arg text, proposed integer, explanation_arg text)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF NOT "knowledge"."corrector_key_holds"(key, digest) THEN
      RAISE EXCEPTION 'only the live corrector key answers requests' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT FROM "knowledge"."correction_request" r WHERE r.id = request) THEN
      RETURN 'missing';
    END IF;
    IF kind_arg = 'taken' THEN
      IF EXISTS (SELECT FROM "knowledge"."correction_event" e WHERE e.request_id = request) THEN
        RETURN 'refused';
      END IF;
    ELSIF kind_arg = 'answered' THEN
      IF NOT EXISTS (SELECT FROM "knowledge"."correction_event" e
                      WHERE e.request_id = request AND e.kind = 'taken')
         OR EXISTS (SELECT FROM "knowledge"."correction_event" e
                     WHERE e.request_id = request AND e.kind IN ('answered', 'closed')) THEN
        RETURN 'refused';
      END IF;
    ELSE
      RETURN 'refused';
    END IF;
    INSERT INTO "knowledge"."correction_event"
        (request_id, kind, corrector_key_id, proposed_version, explanation)
      VALUES (request, kind_arg, key, proposed, explanation_arg)
      ON CONFLICT (request_id, kind) DO NOTHING;
    RETURN CASE WHEN FOUND THEN 'stored' ELSE 'refused' END;
  END
  $$;
--> statement-breakpoint
-- The events of one version's requests, with each answer's proposed version or explanation, for
-- an admin; the requests themselves come from `correction_requests`.
CREATE FUNCTION "knowledge"."correction_events"(route text, version integer, basis text, grant_id uuid)
  RETURNS TABLE (request_id uuid, kind text, proposed_version integer, explanation text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF NOT "knowledge"."admin_basis_holds"(basis, grant_id) THEN
      RAISE EXCEPTION 'only an admin reads correction requests' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT e.request_id, e.kind, e.proposed_version, e.explanation
        FROM "knowledge"."correction_event" e
        JOIN "knowledge"."correction_request" r ON r.id = e.request_id
       WHERE r.route_id = route AND r.version_number = version
       ORDER BY e.at, e.id;
  END
  $$;
--> statement-breakpoint
-- The transaction's account's own corrector key rows, with the columns the data export registry
-- lists for them (spec 0004, R8), one JSON object per row; nothing for another table.
CREATE FUNCTION "knowledge"."own_corrector_key_rows"(entry text)
  RETURNS SETOF jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT pg_catalog.jsonb_build_object('kind', k.kind, 'at', k.at)
      FROM "knowledge"."corrector_key" k
     WHERE entry = 'knowledge.corrector_key'
       AND k.actor_account_id = nullif(pg_catalog.current_setting('app.account_id', true), '')::uuid
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."live_corrector_key"() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."corrector_key_holds"(uuid, bytea) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."revoke_corrector_key"(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."corrector_requests"(uuid, bytea) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."corrector_file"(uuid, bytea, uuid, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."answer_correction_request"(uuid, bytea, uuid, text, integer, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."correction_events"(text, integer, text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "knowledge"."own_corrector_key_rows"(text) FROM PUBLIC;
--> statement-breakpoint
-- Granted while the migrator still owns them, since only the owner may grant.
GRANT EXECUTE ON FUNCTION "knowledge"."live_corrector_key"() TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."revoke_corrector_key"(uuid, text) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."corrector_requests"(uuid, bytea) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."corrector_file"(uuid, bytea, uuid, integer) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."answer_correction_request"(uuid, bytea, uuid, text, integer, text) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."correction_events"(text, integer, text, uuid) TO app_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "knowledge"."own_corrector_key_rows"(text) TO app_api;
--> statement-breakpoint
-- ALTER ... OWNER needs the new owner to hold CREATE on the schema; it holds it only meanwhile.
GRANT CREATE ON SCHEMA "knowledge" TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."live_corrector_key"() OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."corrector_key_holds"(uuid, bytea) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."revoke_corrector_key"(uuid, text) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."corrector_requests"(uuid, bytea) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."corrector_file"(uuid, bytea, uuid, integer) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."answer_correction_request"(uuid, bytea, uuid, text, integer, text) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."correction_events"(text, integer, text, uuid) OWNER TO knowledge_definer;
--> statement-breakpoint
ALTER FUNCTION "knowledge"."own_corrector_key_rows"(text) OWNER TO knowledge_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "knowledge" FROM knowledge_definer;
