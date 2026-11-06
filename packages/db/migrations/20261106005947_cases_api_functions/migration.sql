-- The case API's writes that cross keepers (spec 0007, R1 and R2), as cases_definer. Each reads
-- the identity itself, takes the case's transaction lock (the key the empty-case cleanup uses, which
-- the API also takes before any other write), and names every row it touches.
--
-- create_case: a new case with the caller as its first member and their own person; null when the
-- caller is already in a case. The API checks that the account is confirmed first.
-- hand_over: the keeper of a person without an account makes another member of the case its
-- keeper and drops the person's shares; false unless all of that holds.
-- add_asset: an asset with its first, confirmed owner row, for a person the caller keeps; null
-- when the caller does not keep that person.
-- set_owner: the keeper of a confirmed owner names a co-owner (a pending row, unless the caller
-- keeps that person too), or a keeper changes their own person's share; false when not allowed.
-- A limit reached raises SQLSTATE CL001 with no detail, since it counts rows the caller may not see:
-- 100 assets per case, 12 owner rows per asset, shares adding up to at most 1, pending rows
-- included.
CREATE FUNCTION "cases"."create_case"(display_name text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    caller uuid := nullif(current_setting('app.account_id', true), '')::uuid;
    new_case uuid;
  BEGIN
    IF caller IS NULL THEN
      RETURN NULL;
    END IF;
    INSERT INTO "cases"."case_file" DEFAULT VALUES RETURNING id INTO new_case;
    -- A concurrent call for the same account waits here, then inserts nothing.
    INSERT INTO "cases"."member" (account_id, case_id) VALUES (caller, new_case)
      ON CONFLICT (account_id) DO NOTHING;
    IF NOT FOUND THEN
      DELETE FROM "cases"."case_file" c WHERE c.id = new_case;
      RETURN NULL;
    END IF;
    INSERT INTO "cases"."person" (case_id, keeper_account_id, account_id, display_name, case_member)
      VALUES (new_case, caller, caller, display_name, true);
    RETURN new_case;
  END
  $$;
--> statement-breakpoint
CREATE FUNCTION "cases"."hand_over"(target uuid, new_keeper uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    caller uuid := nullif(current_setting('app.account_id', true), '')::uuid;
    target_case uuid;
  BEGIN
    SELECT p.case_id INTO target_case FROM "cases"."person" p
     WHERE p.id = target AND p.keeper_account_id = caller AND p.account_id IS NULL;
    IF target_case IS NULL OR new_keeper = caller THEN
      RETURN false;
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cases.case_file:' || target_case::text, 0));
    UPDATE "cases"."person" p SET keeper_account_id = new_keeper
     WHERE p.id = target AND p.keeper_account_id = caller AND p.account_id IS NULL
       AND EXISTS (
         SELECT FROM "cases"."member" m WHERE m.account_id = new_keeper AND m.case_id = target_case);
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    DELETE FROM "cases"."share" s WHERE s.person_id = target;
    RETURN true;
  END
  $$;
--> statement-breakpoint
CREATE FUNCTION "cases"."add_asset"(
  owner_person uuid,
  owner_share numeric,
  asset_kind text,
  amount bigint,
  currency text,
  valued date,
  is_liquid boolean,
  sold_on text
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    caller uuid := nullif(current_setting('app.account_id', true), '')::uuid;
    target_case uuid;
    new_asset uuid;
  BEGIN
    SELECT p.case_id INTO target_case FROM "cases"."person" p
     WHERE p.id = owner_person AND p.keeper_account_id = caller;
    IF target_case IS NULL THEN
      RETURN NULL;
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cases.case_file:' || target_case::text, 0));
    IF (SELECT count(*) FROM "cases"."asset" a WHERE a.case_id = target_case) >= 100 THEN
      RAISE EXCEPTION USING ERRCODE = 'CL001';
    END IF;
    INSERT INTO "cases"."asset" (case_id, kind, value_amount, value_currency, valued_at, liquid, sold)
      VALUES (target_case, asset_kind, amount, currency, valued, is_liquid, sold_on)
      RETURNING id INTO new_asset;
    INSERT INTO "cases"."asset_owner" (case_id, asset_id, person_id, share, confirmed)
      VALUES (target_case, new_asset, owner_person, owner_share, true);
    RETURN new_asset;
  END
  $$;
--> statement-breakpoint
CREATE FUNCTION "cases"."set_owner"(target_asset uuid, owner_person uuid, owner_share numeric)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    caller uuid := nullif(current_setting('app.account_id', true), '')::uuid;
    target_case uuid;
    keeps_owner boolean;
  BEGIN
    -- Only an asset of the caller's own case, so nobody takes another case's lock.
    SELECT a.case_id INTO target_case FROM "cases"."asset" a
      JOIN "cases"."member" m ON m.case_id = a.case_id AND m.account_id = caller
     WHERE a.id = target_asset;
    IF target_case IS NULL THEN
      RETURN false;
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cases.case_file:' || target_case::text, 0));
    keeps_owner := EXISTS (
      SELECT FROM "cases"."person" p
       WHERE p.id = owner_person AND p.case_id = target_case AND p.keeper_account_id = caller);
    IF EXISTS (
      SELECT FROM "cases"."asset_owner" o
       WHERE o.asset_id = target_asset AND o.person_id = owner_person) THEN
      IF NOT keeps_owner THEN
        RETURN false;
      END IF;
      UPDATE "cases"."asset_owner" o SET share = owner_share
       WHERE o.asset_id = target_asset AND o.person_id = owner_person;
    ELSE
      IF NOT EXISTS (
        SELECT FROM "cases"."asset_owner" o JOIN "cases"."person" p ON p.id = o.person_id
         WHERE o.asset_id = target_asset AND o.confirmed AND p.keeper_account_id = caller)
        OR NOT EXISTS (
          SELECT FROM "cases"."person" p WHERE p.id = owner_person AND p.case_id = target_case) THEN
        RETURN false;
      END IF;
      IF (SELECT count(*) FROM "cases"."asset_owner" o WHERE o.asset_id = target_asset) >= 12 THEN
        RAISE EXCEPTION USING ERRCODE = 'CL001';
      END IF;
      INSERT INTO "cases"."asset_owner" (case_id, asset_id, person_id, share, confirmed)
        VALUES (target_case, target_asset, owner_person, owner_share, keeps_owner);
    END IF;
    IF (SELECT sum(o.share) FROM "cases"."asset_owner" o WHERE o.asset_id = target_asset) > 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'CL001';
    END IF;
    RETURN true;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "cases"."create_case"(text), "cases"."hand_over"(uuid, uuid), "cases"."add_asset"(uuid, numeric, text, bigint, text, date, boolean, text), "cases"."set_owner"(uuid, uuid, numeric) FROM PUBLIC;
--> statement-breakpoint
-- Granted while the migrator still owns them, since only the owner may grant.
GRANT EXECUTE ON FUNCTION "cases"."create_case"(text), "cases"."hand_over"(uuid, uuid), "cases"."add_asset"(uuid, numeric, text, bigint, text, date, boolean, text), "cases"."set_owner"(uuid, uuid, numeric) TO app_api;
--> statement-breakpoint
GRANT INSERT ON "cases"."case_file" TO cases_definer;
--> statement-breakpoint
GRANT INSERT ("account_id", "case_id") ON "cases"."member" TO cases_definer;
--> statement-breakpoint
GRANT SELECT, INSERT ("case_id", "keeper_account_id", "account_id", "display_name", "case_member"), UPDATE ("keeper_account_id") ON "cases"."person" TO cases_definer;
--> statement-breakpoint
GRANT SELECT, DELETE ON "cases"."share" TO cases_definer;
--> statement-breakpoint
GRANT INSERT ("case_id", "kind", "value_amount", "value_currency", "valued_at", "liquid", "sold") ON "cases"."asset" TO cases_definer;
--> statement-breakpoint
GRANT INSERT ("case_id", "asset_id", "person_id", "share", "confirmed"), UPDATE ("share") ON "cases"."asset_owner" TO cases_definer;
--> statement-breakpoint
-- A member leaves by deleting their own row, under the policy `member_delete_self`.
GRANT DELETE ON "cases"."member" TO app_api;
--> statement-breakpoint
-- ALTER ... OWNER needs the new owner to hold CREATE on the schema; it holds it only meanwhile.
GRANT CREATE ON SCHEMA "cases" TO cases_definer;
--> statement-breakpoint
ALTER FUNCTION "cases"."create_case"(text) OWNER TO cases_definer;
--> statement-breakpoint
ALTER FUNCTION "cases"."hand_over"(uuid, uuid) OWNER TO cases_definer;
--> statement-breakpoint
ALTER FUNCTION "cases"."add_asset"(uuid, numeric, text, bigint, text, date, boolean, text) OWNER TO cases_definer;
--> statement-breakpoint
ALTER FUNCTION "cases"."set_owner"(uuid, uuid, numeric) OWNER TO cases_definer;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "cases" FROM cases_definer;
