-- The case schema's functions and grants (spec 0007, R1). Every table forces row-level security.
--
-- cases_definer, which cannot log in, owns the SECURITY DEFINER functions, so their code runs with
-- only the rows and privileges its own policies and grants allow, never as the schema's owner.
-- Each function pins search_path and names every object by schema. The guards check the list.
--
-- is_member: the one membership check the policies use; a policy on cases.member cannot query
-- cases.member itself. It reads only the identity's own membership.
-- drop_unowned_asset: an asset goes, with any pending owner rows, when its last confirmed owner
-- row goes, whoever deleted that row (a keeper, a person's deletion, a member leaving, erasure).
-- drop_empty_case: a case goes with its last member.
ALTER TABLE "cases"."case_file" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cases"."member" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cases"."person" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cases"."person_profile" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cases"."person_finances" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cases"."dependence" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cases"."asset" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cases"."asset_owner" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cases"."relationship" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cases"."share" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION "cases"."is_member"(target_case uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT FROM "cases"."member" m
       WHERE m.case_id = target_case
         AND m.account_id = nullif(current_setting('app.account_id', true), '')::uuid)
  $$;
--> statement-breakpoint
CREATE FUNCTION "cases"."drop_unowned_asset"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    DELETE FROM "cases"."asset" a
     WHERE a.id = OLD.asset_id
       AND NOT EXISTS (
         SELECT FROM "cases"."asset_owner" o WHERE o.asset_id = OLD.asset_id AND o.confirmed);
    RETURN NULL;
  END
  $$;
--> statement-breakpoint
CREATE FUNCTION "cases"."drop_empty_case"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    DELETE FROM "cases"."case_file" c
     WHERE c.id = OLD.case_id
       AND NOT EXISTS (SELECT FROM "cases"."member" m WHERE m.case_id = OLD.case_id);
    RETURN NULL;
  END
  $$;
--> statement-breakpoint
CREATE TRIGGER "asset_owner_drop_unowned_asset" AFTER DELETE ON "cases"."asset_owner"
  FOR EACH ROW EXECUTE FUNCTION "cases"."drop_unowned_asset"();
--> statement-breakpoint
CREATE TRIGGER "member_drop_empty_case" AFTER DELETE ON "cases"."member"
  FOR EACH ROW EXECUTE FUNCTION "cases"."drop_empty_case"();
--> statement-breakpoint
REVOKE ALL ON FUNCTION "cases"."is_member"(uuid), "cases"."drop_unowned_asset"(), "cases"."drop_empty_case"() FROM PUBLIC;
--> statement-breakpoint
-- Granted while the migrator still owns it, since only the owner may grant: app_api's policies
-- call it.
GRANT EXECUTE ON FUNCTION "cases"."is_member"(uuid) TO app_api;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "cases" TO cases_definer;
--> statement-breakpoint
GRANT SELECT ON "cases"."member", "cases"."asset_owner" TO cases_definer;
--> statement-breakpoint
GRANT SELECT, DELETE ON "cases"."case_file", "cases"."asset" TO cases_definer;
--> statement-breakpoint
-- ALTER ... OWNER needs the new owner to hold CREATE on the schema; it holds it only meanwhile.
GRANT CREATE ON SCHEMA "cases" TO cases_definer;
--> statement-breakpoint
ALTER FUNCTION "cases"."is_member"(uuid) OWNER TO cases_definer;
--> statement-breakpoint
ALTER FUNCTION "cases"."drop_unowned_asset"() OWNER TO cases_definer;
--> statement-breakpoint
ALTER FUNCTION "cases"."drop_empty_case"() OWNER TO cases_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "cases" FROM cases_definer;
--> statement-breakpoint
-- app_api serves the case under row-level security: people and relationships to the case's
-- members, profiles, finances, dependence and owner rows to the keeper and whom it shared them
-- with. Rows whose writes cross keepers (members, assets, new owner rows) are written only through
-- cases_definer functions, added with the case API. app_jobs reads and deletes, under the
-- identity, the members and people erasure removes; their rows go through the cascades.
GRANT USAGE ON SCHEMA "cases" TO app_api, app_jobs;
--> statement-breakpoint
GRANT SELECT ON "cases"."case_file", "cases"."member", "cases"."person", "cases"."person_profile", "cases"."person_finances", "cases"."dependence", "cases"."asset", "cases"."asset_owner", "cases"."relationship", "cases"."share" TO app_api;
--> statement-breakpoint
GRANT INSERT ("id", "case_id", "keeper_account_id", "display_name", "case_member") ON "cases"."person" TO app_api;
--> statement-breakpoint
GRANT UPDATE ("display_name", "case_member") ON "cases"."person" TO app_api;
--> statement-breakpoint
GRANT INSERT ("person_id", "facts", "dependence_answered") ON "cases"."person_profile" TO app_api;
--> statement-breakpoint
GRANT UPDATE ("facts", "dependence_answered", "updated_at") ON "cases"."person_profile" TO app_api;
--> statement-breakpoint
GRANT INSERT ("person_id", "incomes", "assets_recorded_in_full") ON "cases"."person_finances" TO app_api;
--> statement-breakpoint
GRANT UPDATE ("incomes", "assets_recorded_in_full", "updated_at") ON "cases"."person_finances" TO app_api;
--> statement-breakpoint
GRANT INSERT ("case_id", "person_id", "depends_on_id") ON "cases"."dependence" TO app_api;
--> statement-breakpoint
GRANT UPDATE ("kind", "value_amount", "value_currency", "valued_at", "liquid", "sold", "updated_at") ON "cases"."asset" TO app_api;
--> statement-breakpoint
GRANT UPDATE ("confirmed") ON "cases"."asset_owner" TO app_api;
--> statement-breakpoint
GRANT INSERT ("id", "case_id", "kind", "from_person_id", "to_person_id", "details") ON "cases"."relationship" TO app_api;
--> statement-breakpoint
GRANT UPDATE ("details") ON "cases"."relationship" TO app_api;
--> statement-breakpoint
GRANT INSERT ("case_id", "person_id", "grantee_account_id", "scope") ON "cases"."share" TO app_api;
--> statement-breakpoint
GRANT DELETE ON "cases"."person", "cases"."person_profile", "cases"."person_finances", "cases"."dependence", "cases"."asset", "cases"."asset_owner", "cases"."relationship", "cases"."share" TO app_api;
--> statement-breakpoint
GRANT SELECT, DELETE ON "cases"."member", "cases"."person" TO app_jobs;
